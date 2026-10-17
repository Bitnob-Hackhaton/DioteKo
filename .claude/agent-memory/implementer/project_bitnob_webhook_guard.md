---
name: bitnob-webhook-guard
description: Increment 5 backend-nest — Bitnob webhook signature guard + transfer.* -> withdrawal status; the non-obvious gotchas
metadata:
  type: project
---

`backend-nest/src/modules/bitnob/` webhook layer after **Increment 5** (signature verification +
`transfer.*` handling). Builds on [[bitnob-read-services-layout]] and [[bitnob-money-safety-model]].

**Why:** `/api/bitnob/webhooks/*` were `@Public()` with no signature check — anyone could forge a
`payouts.withdrawal.success` and flip a money row. Increment 4 shipped withdrawals with no webhook
handling at all.

**Shape:**
- `main.ts` -> `NestFactory.create(AppModule, { rawBody: true })`. Populates `req.rawBody` (Buffer)
  for `application/json` — documented Nest 11 behavior; the guard fails closed (401) if it is ever
  absent, so no runtime assertion was added.
- `bitnob.webhookSecret` config = `BITNOB_WEBHOOK_SECRET || BITNOB_CLIENT_SECRET || ''`. In
  `OPTIONAL_WARN_VARS`; `env.validation.ts` emits a dedicated warn when the fallback is taken.
- `guards/bitnob-webhook-signature.guard.ts` — `CanActivate`, injects `ConfigService` only, NO DB.
  Not in module `providers[]` (a class in `@UseGuards` is auto-instantiated). HMAC-**SHA512** hex
  over `req.rawBody` — NOT `bitnob-hmac.util.ts` (that is the outbound SHA256-over-`clientId:ts:nonce`
  scheme). Order: secret-empty (prod->401, dev->allow+`bitnobSignatureValid=false`) -> header
  present/single/`/^[0-9a-f]{128}$/i` -> `rawBody` is Buffer -> `timingSafeEqual`. Every reject is
  `UnauthorizedException` + a warn with source IP + best-effort `event` name.
- **GOTCHA (M1):** `Buffer.from(badHex, 'hex')` does NOT throw — it silently truncates at the first
  non-hex char. `crypto.timingSafeEqual` DOES throw (generic `RangeError` -> 500) on a length
  mismatch. So BOTH the `128`-hex-char regex AND an explicit `providedBuf.length !== expectedBuf.length`
  check are needed to keep it from 500-ing. Removing either is caught by the guard spec.
- `bitnob-webhooks.controller.ts` — `@UseGuards(BitnobWebhookSignatureGuard)` class-level (documented
  deviation from the global-`APP_GUARD` pattern; keeps `@Public()`). Single catch-all `@Post()`
  dispatches by `event` name; `@Post('payouts')` DROPPED, `@Post('cards')` kept. Payout
  `callback_url` (built in `bitnob-payouts.service.ts`) repointed `/api/bitnob/webhooks/payouts` ->
  `/api/bitnob/webhooks`.
- `bitnob-webhook.service.ts` `handleWebhook(payload, signatureValid, dispatch)`:
  - **M2**: `signatureValid === false` -> persist row + `processed=true` + warn, NO dispatch, in
    every env.
  - **M3**: `event_id` non-null -> pre-check SELECT (return idempotent 200 if found) + wrap insert,
    catch `QueryFailedError` code `23505` -> idempotent 200. Stored row's `event` name != incoming
    -> `logger.error('event_id collision')`, still 200.
  - `dispatchByEventName`: `transfer.*` -> `dispatchTransferEvent`, `payouts.*` ->
    `dispatchPayoutEvent`, `card.`/`cards.` -> `dispatchCardEvent` (all families hit the one
    global URL -> the catch-all; `@Post('cards')` is now a legacy alias), else persist-only.
- `dispatchTransferEvent` — **withdrawals ONLY** (M4: `data.transaction_id <-> bulk item
  `withdrawal_id` identity unverified, bulk 403 in sandbox). Match `bitnob_withdrawals` by
  `data.reference` then `data.transaction_id -> transactionId`. Forward-only via
  `withdrawalStatusRank` (`withdrawals.util.ts`: `pending:0 submitted:1 completed:2 failed:2`).
  Already-terminal + different terminal status -> `logger.error('contradicts terminal status')`
  (M6). Writes `data.hash -> txHash`, `data.fee -> networkFee`. `rawResult` is **merged, not
  overwritten**: `{ ...existing, webhook: stripWithdrawalResultPii(payload) }` —
  `reconcileWithdrawal` only touches `status`, so a wholesale replace would lose the Inc4 S1
  create-time body.
- `sanitizeEventName` (`withdrawals.util.ts`) — strips `[\r\n\t]`, caps 64 chars. The Bitnob
  `event` name is attacker-influenced on a forged delivery; raw value drives dispatch + storage,
  only the sanitised form reaches a log line (all NEW Inc5 log lines + guard reject line). Guard
  reject log distinguishes `event=<name>` / `event=absent` (parsed, no key) / `event=unparseable`.
- Controller handlers both `@HttpCode(200)` (Nest `@Post()` defaults 201; Bitnob retries non-2xx).
- `PAYOUT_STATUS_RANK` exported from `payouts.util.ts` (symmetry with `WITHDRAWAL_STATUS_RANK`).
- Migration `1788230400000-AddWebhookSignatureAndTransferColumns` — additive:
  `bitnob_webhook_events.signature_valid boolean NOT NULL DEFAULT true`,
  `bitnob_withdrawals.tx_hash varchar NULL` + `network_fee numeric NULL`. Drift-clean.
- Tests: `bitnob-webhook-signature.guard.spec.ts` (8) + reworked `bitnob-webhook.service.spec.ts`
  (16). Suite went 13/132 -> 14/150. Code-reviewer verdict SHIP (M1–M9 all confirmed).

**Still open (KNOWN_ISSUES "Bitnob webhook signature verification (Increment 5 ...)"):** which secret
Bitnob actually signs with (live delivery needed); `retryItems` must re-poll remote state before the
bulk prod gate lifts (M5); webhook never touches `payments.status` (S4); `bitnob_webhook_events.payload`
persisted unscrubbed (S3).
