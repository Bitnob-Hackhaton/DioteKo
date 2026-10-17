---
name: bitnob-webhook-verification
description: Increment 5 (backend-nest Bitnob webhook HMAC-SHA512 signature guard + transfer.* -> withdrawal/bulk status) security review — the conditions it must ship with and the replay/verified-webhook-drives-money reasoning
metadata:
  type: project
---

Increment 5 adds `main.ts { rawBody: true }`, a `BitnobWebhookSignatureGuard`
(`CanActivate`, class-level `@UseGuards` on the still-`@Public()`
`bitnob-webhooks.controller.ts`), a `bitnob_webhook_events.signature_valid`
column, and lets verified `transfer.success` / `transfer.failed` drive
`bitnob_withdrawals` / `bitnob_bulk_batch_items` status (forward-only guard
mirroring `dispatchPayoutEvent`). Verdict: APPROVE WITH CONDITIONS.

**Verified webhook contract (integration-analyst):** header `x-bitnob-signature`
(lowercase, hex, no prefix), HMAC-**SHA512** over the **raw body bytes** (NOT the
request-signing SHA256-over-`clientId:ts:nonce:payload` scheme — must not reuse
`bitnob-hmac.util.ts`). NO timestamp / NO replay window -> `event_id` idempotency
is the only replay defense. One global dashboard webhook URL; withdrawals + bulk
have no per-request `callback_url`. Source IPs `18.171.51.218` / `13.134.154.133`
(Bitnob has rotated these before). `transfer.*` `data`: `address, amount, chain,
currency, fee, hash, reference, timestamp` (+ `transaction_id` on success); no
`data.status` — branch on the `event` name. Bulk item webhooks carry NO per-item
`reference` -> only matchable via `data.transaction_id` <-> item `withdrawal_id`,
an UNVERIFIED identity.

**Guard composition (confirmed):** Nest runs guards global -> controller ->
handler, ALL before the route handler and before the service. `@Public()` is only
consulted inside `JwtAuthGuard`; a controller-scoped `@UseGuards` still executes.
So the signature guard runs, runs before the handler, and a rejected signature
means `BitnobWebhookService` is never called -> no `bitnob_webhook_events` row on
a forged body. This composition is sound.

**Replay analysis:** the signature covers the body, so an attacker can only
replay a GENUINE Bitnob-signed event, not forge values. Already-processed
`event_id` -> unique index -> idempotent 200. New-to-us `event_id` -> processed as
fresh, but the content is real Bitnob data for a transfer that really happened;
worst case is advancing our local status to the true remote state earlier than the
reconcile poll would. Contained by the forward-only rank guard + "reconcile is the
authority for money decisions". The sharp edge: a genuine-but-stale or
wrong-item-matched `transfer.failed` marking a succeeded item/withdrawal `failed`,
which then justifies a re-send.

**MUST-FIX conditions:**
1. Guard throws Nest `UnauthorizedException` (never a raw `Error` -> 500 + retry
   storm + dev stack leak). Validate the header is a single string matching
   `/^[0-9a-f]{128}$/i` BEFORE `crypto.timingSafeEqual` (which throws on length
   mismatch); handle header-as-array; missing `rawBody`/header -> 401. Optionally
   assert `content-type: application/json` before trusting `rawBody`.
2. An unverified event (`signature_valid === false`, the dev no-secret path) must
   PERSIST to `bitnob_webhook_events` + log a loud warn, and then do NOTHING else
   — no dispatch, no money-table mutation — in EVERY environment, not just prod.
   One invariant ("unverified never mutates money state") beats env-conditional
   reasoning.
3. `event_id` dedup: SELECT-by-`event_id` pre-check AND catch Postgres `23505` ->
   return the idempotent `{ received: true }` 200 (fixes the current uncaught-500
   -> infinite Bitnob retry). On a `23505` where the stored row's event
   name/type differs from the incoming one, log at error (`event_id collision`)
   but still 200. Dispatch must stay idempotent for the null-`event_id` case
   (Postgres allows multiple NULLs).
4. Do NOT mutate `bitnob_bulk_batch_items` from `transfer.*` this increment — the
   `data.transaction_id` <-> `withdrawal_id` identity is an unverified guess
   (bulk is 403 in sandbox). Persist the event, log both ids, no write. Wait for a
   sandbox bulk probe. (Matches the Increment 4 memory's bulk caution.)
5. `retryItems` (and any future withdrawal re-send) currently trusts local
   `status === 'failed'`. Once a webhook can write `failed`, a stale/mismatched
   `transfer.failed` becomes sufficient justification for a double on-chain send.
   Before the prod gate is lifted, retry must re-poll remote item state and only
   re-send items Bitnob also reports failed. Document as a prod-gate-lift blocker.
6. Contradictory terminal events (`transfer.success` then `transfer.failed` on the
   same row, or vice versa) must be logged at ERROR as a reconcile-required alarm
   — not a silent `warn`+drop.
7. Never log the secret, the `x-bitnob-signature` value, or `req.rawBody`.
   `transfer.*` dispatch logs ids only (`reference`, `transaction_id`, truncated
   `hash`) — never `data` wholesale. Payout dispatch stays ids-only (do not start
   logging `data.beneficiary`, which carries a masked account number). A
   `BitnobApiError` reaching `processing_error` must go through
   `summarizePayoutError`.
8. Signature rejections must be logged actionably (source IP + event name if
   cheaply parseable from the raw buffer in a try/catch) — `access_logs` can't be
   used (its `resource_id` is `uuid NOT NULL`), so a structured warn line is the
   bar.
9. `WITHDRAWAL_STATUS_RANK` must match the real Inc 4 entity vocabulary
   (`pending -> submitted -> completed|failed`) — do NOT invent a `processing`
   local withdrawal status; `transfer.*` maps only to the two terminal ranks.

**Secret fallback (`BITNOB_WEBHOOK_SECRET || BITNOB_CLIENT_SECRET`):** acceptable —
the inbound SHA512-over-raw-body and outbound SHA256-over-`clientId:ts:nonce:payload`
schemes don't cross-forge, and a wrong key fails every delivery closed (noticed
immediately), not open. Conditions: add `BITNOB_WEBHOOK_SECRET` to
`OPTIONAL_WARN_VARS`; emit a one-time startup WARN when falling back; resolve
"which key does Bitnob actually use" via a live sandbox delivery before the
withdrawal/bulk prod gate is lifted.

**Fail-closed:** secret fully unset + `bitnob.environment === 'production'` -> 401.
Correct. Keep it.

**SHOULD-FIX / advisory:**
- Source-IP allowlist: do NOT make it a hard 403 (Bitnob rotates IPs; a proxy
  makes `req.ip` the proxy). Log-only if a config list is provided, else skip.
- `bitnob_webhook_events.payload` is persisted unscrubbed (pre-existing). Payout
  events carry a masked account number per contract, so acceptable; consider a
  `stripPayoutPii`/`stripWithdrawalResultPii` pass on the persisted payload for
  defense in depth.
- `payments.status` desync: the webhook flips `bitnob_payouts.status` but not the
  linked `payments` row (only `reconcileBitnobPayoutForCertificate` does).
  Pre-existing, acceptable under "reconcile is authority" — note in KNOWN_ISSUES.
- No throttle on the `@Public()` webhook route. HMAC verify is cheap + no DB write
  on failure, so the DoS surface is small; a coarse throttler is a later nice.
- Migration `signature_valid boolean NOT NULL DEFAULT true` backfills pre-existing
  rows as trusted (they predate verification) — fine; new inserts always pass an
  explicit value. `tx_hash` / `network_fee` nullable additive. Hand to
  `@migration-reviewer`.
- Prefer repointing the payout `callback_url` to the new catch-all `@Post()` and
  dropping the `payouts` sub-route (smaller long-term surface); double-delivery to
  both URLs is already handled by `event_id` idempotency.
- Add a guard unit test with a hand-computed SHA512 HMAC + an explicit
  length-mismatch case.

Related: [[bitnob-payout-money-safety]], [[bitnob-withdrawals-bulk-money-safety]],
[[bitnob-hmac-signing]], [[backend-nest-rewrite]].
