---
name: bitnob-api-facts
description: Verified live facts about the Bitnob sandbox API (envelopes, error shape, quirks) captured while wiring backend-nest/src/modules/bitnob read endpoints
metadata:
  type: project
---

Facts confirmed against the **live Bitnob sandbox** (`client_name: "DioteKo"`, `environment: sandbox`) while implementing Increment 2 of the Bitnob read-endpoints plan.

**Why:** the plan's contract marked the error shape as "NOT verified live"; these were captured with throwaway probes so future increments (payout rework = Increment 3, trading/cards rebuild) don't have to re-discover them.

**How to apply:** rely on `BitnobApiError { message, status, responseBody }` (raw body preserved by `BitnobHttpClientService`) for error handling — do not assume `{ success: false }` on errors.

- Base URL `https://api.bitnob.com`, **no `/api/v1` prefix** for read endpoints (`/api/whoami`, `/api/balances`, `/api/exchange-rates`, `/api/transactions`). The payout methods in `BitnobService` still use `/api/v1/payouts...` and are unverified (Increment 3).
- Success envelope: `{ success, message, data, timestamp }`. `unwrapBitnob()` in `common/bitnob-envelope.util.ts` peels it; it is defensive (passes non-envelope bodies through).
- **Error shape is RFC 7807 + extras**: `{ type, title, status, detail, code, correlation_id, timestamp, request_id }`. `type` is a URL like `https://api.bitnob.com/errors/NOT_FOUND`; `code` is `NOT_FOUND` / `VALIDATION_ERROR` / etc.
- `GET /api/balances/:currency` with an unknown currency returns **400 `VALIDATION_ERROR`** ("no account found for currency: X"), NOT 404 as the plan predicted.
- `GET /api/transactions/:unknown-uuid` returns 404 `NOT_FOUND`.
- `GET /api/exchange-rates?from=ZZZ&to=NGN` (bad currency) returns 400 `VALIDATION_ERROR`.
- Balances list rows DO include `account_id` + `*_formatted` display fields; `data.metadata.request_id` was absent on the sandbox responses (treat as optional, as the plan said).

**Payout flow — verified live (Increment 3 probe, throwaway):**
- 3 steps confirmed: `POST /api/payouts/quotes` → `POST /api/payouts/:quoteId/initialize` → `POST /api/payouts/:quoteId/finalize`. The path param on initialize/finalize is the **`quote_id` string** (e.g. `QT2_21052226`), NOT the payout UUID. `GET /api/payouts/:id` path IS the payout UUID (`data.payout.id`); passing a `quote_id` there → 400.
- `quote_id` format is **`QT2_<digits>`** (not `QT_...` as an earlier memo guessed) — do not regex-validate its shape.
- Quote wire body that works: `{ from_asset:'USDT', to_currency:'NGN', country:'NG', source:'offchain', settlement_amount:'500', reference }`. `settlement_amount` is DISPLAY units. Response `data.payout` has `amount` (crypto, e.g. `"0.364552"`) **populated**, plus `sat_amount`/`btc_amount`/`cent_amount`, `exchange_rate{rate,btc_rate,currency,effective_rate}`, `trip`, `expires_at` (~15 min).
- Initialize response `data` has keys `["payout","data"]` (nested `data.data` — ignore). `data.payout` gains `beneficiary` + `payment_reason`, loses `trip`/`cent_amount`. `status` → `"INITIATED"`. `customer_id` is NOT required and no error mentions it.
- **Sandbox does NOT validate the beneficiary account at initialize time** — an all-zeros `account_number` still returns 200 `INITIATED`. Bank-rejection failures surface only later (finalize / `GET /api/payouts/:id`), never a 4xx at initialize. There is no failure webhook.
- **Double-initialize the same quote → HTTP 400**, body is RFC 7807: `{ type, title:"Validation Error", status:400, detail:"Quote '...' has already been initialized", code:"VALIDATION_ERROR", correlation_id, timestamp, extensions:{metadata:{quote_id,reason:"already_initialized"}}, request_id }`. No `success` key. Confirms the error shape above + adds `extensions`.
- `GET /api/payouts` → `data.{items[], total_count, limit, offset, has_more}` (offset pagination). `GET /api/payouts/account-lookup?country=&bank_code=&account_number=` → `data.{account_name,account_number,bank_code,bank_name,country,is_verified}`. `supported-countries` → `data.countries`; `supported-countries/:c` → `data.{code,name,flag,dial_code,destination_types}`; `banks/:cc` → `data.{banks,country_code,country_name,total}`; `limits` → `data.limits`.

Related: [[bitnob-read-services-layout]]
