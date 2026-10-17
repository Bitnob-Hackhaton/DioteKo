---
name: bitnob-money-safety-model
description: The recurring safety pattern for Bitnob money-movement code in backend-nest (payouts, withdrawals, bulk transfers) — prod gate, CAS, revert vs no-revert
metadata:
  type: project
---

`backend-nest` Bitnob money code follows a consistent safety model across increments.
When adding/reviewing a new money path, match it:

- **Production gate is the FIRST line of the money-moving SERVICE method** (not just the
  controller): `if (this.config.get('bitnob.environment') === 'production') throw new
  ForbiddenException('... disabled in production (Increment N interim state)')`. Each has
  a spec asserting the throw happens before any Bitnob call. Applies to
  `BitnobPayoutsService.finalizePayout`, `BitnobWithdrawalsService.createWithdrawal`,
  `BitnobBulkTransfersService.{createDraft,confirmBatch,retryItems}`.
- **Local row created BEFORE the Bitnob call** with a deterministic `reference`
  (`dkpayout_<id>` / `dkwd_<id>`) = Bitnob's only idempotency key. Partial unique index
  on `reference WHERE reference IS NOT NULL` (the row exists briefly with null reference).
  Note: a blocked-in-prod attempt still leaves a `failed` row + an `access_logs` row —
  that is an accepted audit trail, consistent with `createQuote`.
- **Atomic CAS before EVERY money-moving Bitnob call that lacks its own idempotency key.**
  `repo.update({ id/ids, status: 'X' }, { status: 'X_transient' })`, `affected` mismatch
  -> `ConflictException`. Covers: payout `finalize` (`initiated->finalizing`), bulk
  `confirm` (`draft->confirming`), and bulk `retry` (per-item
  `failed->processing`, `itemsRepo.update({ id: In(itemIds), batchId, status: 'failed' },
  { status: 'processing' })` — `In()` in `.update()` criteria works fine on TypeORM
  0.3.31, verified against the real DB). A naive "read status then POST" is a
  double-send bug when two admins act concurrently.
- **Revert-on-failure differs by path**:
  - payout `finalize` DOES revert `finalizing -> initiated` on failure — safe because it
    re-reads the remote status and only disburses when it is exactly `INITIATED`.
  - bulk `confirm` does NOT revert `confirming -> draft`, and bulk `retry` does NOT revert
    items `processing -> failed` — neither has an idempotency key, so a revert+retry after
    a lost response would double-disburse. `confirm` -> `confirm_uncertain`; `retry`
    leaves items `processing`. Both need an explicit
    `POST /bulk-transfers/:id/reconcile`.
  - raw withdrawal `create`: on a DEFINITE rejection (`HttpException`, or
    `BitnobApiError` with a numeric `.status`) the row is `failed` + `reference` stays
    null. On an INDETERMINATE failure (`BitnobApiError.status === null` = network-level,
    Bitnob MAY have created it) the row is parked at non-terminal `submitted` with its
    `reference` PERSISTED, so `reconcile` can poll — dropping the reference would let a
    client retry mint a fresh `dkwd_<newid>` that Bitnob won't dedup (double send). The
    raw withdrawal path still has NO content-derived idempotency key: a hash of
    `to_address+amount+currency+chain` is a prerequisite before lifting the prod gate.
- **Error handling**: catch blocks route through `summarizePayoutError` (in
  `payouts.util.ts` — shared, PII-safe: keeps only RFC 7807 `code`/`title`/`type`, never
  `detail`/`message`). Re-throw `HttpException`; map raw `BitnobApiError` ->
  `BadGatewayException` (502). Never interpolate `err.message`/`err.stack` into a
  response or a `raw_result` jsonb.
- **`raw_result` is PII-scrubbed before persistence** — `stripPayoutPii` (payouts) /
  `stripWithdrawalResultPii` (withdrawals/bulk, also strips `memo`/`sender`).

**Why:** money movement is high-stakes; a security-analyst review gated Increments 3 & 4
on exactly these conditions. **How to apply:** any new Bitnob write path (Increment 5+,
trades, cards) should reuse this model rather than reinventing it. See also
[[bitnob-sandbox-limits]].
