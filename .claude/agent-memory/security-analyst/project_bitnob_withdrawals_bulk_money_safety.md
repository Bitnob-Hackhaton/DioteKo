---
name: bitnob-withdrawals-bulk-money-safety
description: Increment 4 (backend-nest Bitnob on-chain withdrawals + bulk transfers) money-out review — the deltas vs the payout pattern and the conditions it must ship with
metadata:
  type: project
---

Increment 4 adds `POST /api/withdrawals` (on-chain crypto send, table `bitnob_withdrawals`)
and `POST /api/bulk-transfers` draft -> `/:batchId/confirm` (mass on-chain send, tables
`bitnob_bulk_batches` + `bitnob_bulk_batch_items`) to `backend-nest/src/modules/bitnob/`.
It copies the Increment 3 payout pattern
([[bitnob-payout-money-safety]]); only the deltas below matter.

**Key structural differences from payouts (why the deltas exist):**
- Withdrawal destination is a caller-supplied on-chain address (payouts hardcoded the
  beneficiary from env). Chain address format is validated by Bitnob (422), unlike the
  bank account on payout `initialize`.
- There is NO separate `finalize` step for a withdrawal — `POST /api/withdrawals` creates
  AND disburses in one call. So the `BITNOB_ENVIRONMENT==='production'` throw is the ONLY
  barrier before money moves (for payouts, `finalize` pre-polled remote status first).
- Bulk `confirm` = one HTTP call -> N irreversible on-chain sends. No idempotency key on
  the confirm call (batch-level `idempotency_key` is only on draft creation).
- No `GET /api/withdrawals/:id` — reconcile ONLY via `GET /api/transactions?reference=`.
  `GET /api/bulk-transfers/:batchId` does exist.
- `transfer.success`/`transfer.failed` webhooks are SHARED across withdrawals, deposits,
  and (probably) bulk items; the webhook is `@Public()` plus `BitnobWebhookSignatureGuard` (HMAC-SHA512 verified).
- Sandbox min stablecoin withdrawal is $10; sandbox wallet ~5 USDT => a withdrawal can
  never complete end-to-end in sandbox.

**MUST-FIX conditions to ship (sandbox-only, real crypto-out deferred):**
1. Prod gate (`config.get('bitnob.environment')==='production'` -> `ForbiddenException`)
   lives IN the service methods `createWithdrawal` + `confirmBatch` (mirror
   `bitnob-payouts.service.ts` `finalizePayout`), not just the controller, each with a spec.
2. Bulk `confirm`: atomic CAS on batch status (`draft -> confirming`, assert affected===1,
   mirror payout `initiated -> finalizing`) + prod gate + a re-stated `expected_total` +
   `expected_item_count` in the confirm body that the service verifies against the summed
   persisted `bitnob_bulk_batch_items` rows (409 on mismatch — the bulk analogue of payout
   finalize's pre-poll gate).
3. Bulk `confirm` failure MUST NOT revert `confirming -> draft` (payout finalize reverts to
   `initiated`; bulk must not). No idempotency key on confirm => revert + re-confirm after a
   timeout double-sends. Leave it `confirming`/`confirm_uncertain`, force `GET
   /api/bulk-transfers/:id` reconcile.
4. `amount` DTO: strict positive-integer-string regex (`/^[1-9]\d{0,17}$/`), BigInt runtime
   backstop, mandatory per-call max constant. Restrict `currency` to USDT/USDC this
   increment so the $10 min is a pure integer check (`>= 10_000_000`) — defer BTC (needs FX).
5. Bulk `amount` handling must NOT merge while base-units-vs-decimal is unresolved
   (integration-analyst open probe item).
6. `memo`/`description` DTO: `@MaxLength` + single-line `@Matches` (reuse
   `PAYMENT_REASON_SINGLE_LINE`); values never logged (presence/length only); prefer
   omitting `memo` entirely this increment (some chains write it permanently on-chain).
7. Defer ALL `transfer.*` webhook handling to Increment 5 (with signature verification).
   This increment: event still persists to `bitnob_webhook_events` (already happens first),
   dispatch no-ops, rely on polling. Unverified `@Public()` webhook writing a money table =
   forge-to-flip-status vector.
8. `bitnob_withdrawals` partial unique index on `reference WHERE reference IS NOT NULL`
   (mirror `UQ_bitnob_payouts_reference`); `bitnob_bulk_batches` unique on `idempotency_key`.

**Advisory:** don't populate `subject_did_id` on the raw withdrawal path (DID <-> chain
address is a permanent public correlation) — keep `access_logs.metadata` to `{reference}`
like `bitnob-money.controller.ts`; keep a `stripPayoutPii`-style scrub on `raw_result`
anyway (cheap); reconcile must match exact `reference` + assert tx type + warn/no-write on
ambiguity or unknown status (mirror `mapBitnobPayoutStatus`); bulk `@ArrayMaxSize` + total
cap re-checked at confirm + intra-batch duplicate-address check; migration items->batch FK
CASCADE is defensible (child of aggregate) but make it conscious, name the constraint,
never expose a batch hard-delete, `down()` drops items before batches, `amount` as
`numeric`.

**Deferred to a pre-production increment (write down as prod-gate-lift blockers):**
destination-address allowlist OR per-day amount cap OR two-person approval for
withdrawals/bulk; background reconcile poller; verified `transfer.*` webhooks.

**Probe rules (additive to Increment 3's):** NEVER call bulk `confirm`; use a sub-$10
amount or invalid address; run the 409/duplicate-reference test exactly ONCE (it parks
sandbox balance in a never-resolving `pending` withdrawal); throwaway testnet address only;
assert non-prod env before any POST; never log `X-Auth-*` / `clientSecret` / `memo`.

Related: [[bitnob-payout-money-safety]], [[bitnob-hmac-signing]], [[backend-nest-rewrite]].
