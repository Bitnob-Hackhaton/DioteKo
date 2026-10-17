---
name: bitnob-sandbox-limits
description: DioteKo Bitnob sandbox account limitations found probing Increment 4 (withdrawals + bulk transfers) — which endpoints can/can't be exercised live
metadata:
  type: project
---

The DioteKo Bitnob **sandbox** account (`BITNOB_CLIENT_ID=39c79099-22b8-47cf-82e4-21c8f2c8e5d2`,
secret `prd:sandbox_...`) has these limits, discovered by a throwaway probe
during Increment 4 implementation:

- **Bulk transfers WRITE is disabled**: `POST /api/bulk-transfers` (and by extension
  `/confirm`, `/retry`) returns **403 `FORBIDDEN` / "Feature Not Enabled"**.
  `GET /api/bulk-transfers` DOES work (returned `{ batches: [], next_page_token }`).
  So bulk request/response shapes are implemented to the integration-analyst contract,
  NOT verified against a live sandbox.
- **No USDT/USDC wallet balance**: `POST /api/withdrawals` for any stablecoin amount
  returns **422 `INSUFFICIENT_FUNDS`** before any minimum-amount check — so the Bitnob
  "$10 minimum" error and the same-`reference` **409 dedup** could NOT be observed.
- **Address validate**: `POST /api/addresses/validate` works. Response `data` is
  `{ valid: boolean, address, chain, error?: string }` — field is `valid` (NOT
  `is_valid`); `error` string present only when `valid === false` (e.g. `"invalid address"`).
- **Withdrawal error body** is RFC 7807: `{ type, title, status, detail, code,
  correlation_id, timestamp, request_id }` (+ `extensions` sometimes). A malformed
  `to_address` -> **400 `VALIDATION_ERROR`** (not 422).
- Payout quote (`POST /api/payouts/quotes`) works fine (used by the smoke test).

**Why:** these gaps shaped Increment 4 decisions — bulk `amount` is treated as base-unit
integer string (unverifiable; chosen for consistency with the verified withdrawal
contract since each bulk item resolves to a withdrawal), and the $10 minimum is enforced
client-side (`WITHDRAWAL_MIN_BASE_UNITS = 10_000_000n`, USDT/USDC only, no FX call).

**How to apply:** for webhook handling and any future bulk-transfer work,
don't expect to test bulk writes or funded withdrawals on this sandbox. Ask Bitnob to
enable the bulk feature + fund a sandbox stablecoin wallet, or test against a different
account. A `@integration-analyst` check of the live docs is the fallback for
unverifiable shapes. See also [[bitnob-money-safety-model]].
