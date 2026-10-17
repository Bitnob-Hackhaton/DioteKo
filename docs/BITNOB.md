# Bitnob Integration — DioteKo

Complete reference for the Bitnob crypto payment module. For decision rationale, see
`docs/DECISIONS.md`; for known issues and blockers, see
`docs/KNOWN_ISSUES.md` (§"Bitnob…").

## Overview

**Module location:** `backend-nest/src/modules/bitnob/` — NestJS integration for Bitnob's
crypto and fiat APIs (payouts, withdrawals, bulk transfers, identity, rates, transactions).

**Scope this increment** (Increments 1–5 — DID/VC certificate payflow):
- Identity (`whoami`) — Bitnob client metadata
- Read-only — balances, exchange rates, transactions, payout/withdrawal lookups
- Payouts (fiat off-ramp) — quote → initialize → finalize, 3 steps, prod-gated
- Withdrawals (on-chain crypto) — `POST /api/withdrawals`, reference dedup, $10 minimum
- Bulk transfers (batch crypto sends) — draft → confirm, N items, irreversible

**Deferred** (stubs only, no write path):
- Trading (crypto spot exchange)
- Cards (virtual/physical)
- Customers & beneficiaries
- Bitnob Lightning (LNURL pay)

**Sandbox vs. Production:** Both use `https://api.bitnob.com`; sandbox and production
environments are identical hosts — only the API key (`BITNOB_CLIENT_SECRET`) differs.

---

## API Contract

**Base URL:** `https://api.bitnob.com` (no `/v1/` path segment).

**Response envelope** (all endpoints):
```json
{
  "success": true,
  "message": "Success or error description",
  "data": { /* endpoint-specific payload */ },
  "timestamp": "2026-08-30T12:34:56Z"
}
```

**Error shape** (RFC 7807 + Bitnob extras):
```json
{
  "type": "https://errors.bitnob.com/...",
  "title": "Bad Request",
  "status": 400,
  "detail": "Field validation failed",
  "code": "VALIDATION_ERROR",
  "correlation_id": "req-abc123"
}
```

**Money units** (critical):
- **Base units** (default): integers as strings (USDT 1e6 = `"1000000"`, BTC sats = `"100000000"`).
  All read endpoints, withdrawals, bulk transfers use base units.
- **Display units** (exception): Payout fields (`settlement_amount`, `amount`) are displayed
  units as strings (₦5000 = `"5000"`, 3.6 USDT = `"3.6"`). Limits queries also return display units.

**Unwrapping:** `unwrapBitnob(response)` helper (`src/modules/bitnob/common/bitnob-envelope.util.ts`)
extracts `response.data` and throws `BitnobApiError` on non-success. Use this on every API call.

---

## HMAC Request Signing (Outbound Only)

Bitnob verifies every request via an `X-Auth-*` header quartet. This is a **different scheme**
from webhook signing (SHA256 vs SHA512, request vs body-only).

**Invariant:** The signed string IS the wire string — never re-serialize or sort keys.

**Flow** (in `BitnobHttpClientService`):

1. Build the wire body: `payload = JSON.stringify(body)` (compact, insertion-order).
2. Build auth headers via `buildAuthHeaders(clientId, secret, payload)`:
   ```
   stringToSign = `${clientId}:${timestampSeconds}:${nonce}:${payload}`
   hmacSha256 = hex(HMAC-SHA256(secret, stringToSign))
   headers = {
     X-Auth-Client: clientId,
     X-Auth-Timestamp: timestampSeconds,
     X-Auth-Nonce: nonce,
     X-Auth-Signature: hmacSha256,
     Content-Type: application/json
   }
   ```
3. Send via `axios.post(path, payload, { headers, transformRequest: [(d) => d] })`.
   - `transformRequest: [(d) => d]` is load-bearing — it tells axios not to re-serialize.
   - The identity transform ensures the signed bytes and wire bytes are identical.

**GET requests:** `payload = ''` (empty string). Query params are NOT signed.

**Files:**
- `src/modules/bitnob/services/bitnob-hmac.util.ts` — signing logic
- `src/modules/bitnob/services/bitnob-http-client.service.ts` — request executor

---

## 3-Step Payout (Fiat Off-Ramp)

**Flow:** quote → initialize → finalize. Money **never** moves until `finalize`.

**1. Quote** — `POST /api/payouts/quotes`

Request (display units for settlement):
```json
{
  "from_asset": "BTC",
  "to_currency": "NGN",
  "country": "NG",
  "source": "offchain",
  "settlement_amount": "50000",
  "reference": "dkpayout_<uuid>"
}
```

Response: `{ success: true, data: { payout: { quote_id: "QT2_...", id: "...", status: "QUOTE", ... } } }`

Store locally: `bitnob_payouts` row with `status='quote'`, `reference=dkpayout_<row.id>`, `raw_quote`.

**2. Initialize** — `POST /api/payouts/:quoteId/initialize`

Request (pass the stored `reference`; `payment_reason` is REQUIRED):
```json
{
  "quote_id": "QT2_...",
  "reference": "dkpayout_<uuid>",
  "payment_reason": "salary",
  "callback_url": "https://<app>/api/bitnob/webhooks/payouts",
  "beneficiary": {
    "destination_type": "bank",
    "country": "NG",
    "account_number": "1234567890",
    "account_name": "John Doe",
    "bank_code": "044"
  }
}
```

Response: `{ success: true, data: { payout: { status: "INITIATED", ... } } }`

Update locally: `status='initiated'`. **Beneficiary is env-configured** in this increment —
see "Config" below. No money moves.

**3. Finalize** — `POST /api/payouts/:quoteId/finalize`

Request (body is empty):
```json
{}
```

Response: `{ success: true, data: { payout: { status: "PENDING" | "PROCESSING", ... } } }`

Update locally: `status='processing'`. **Money moves on this call** (real fiat debit). Funds
may take 24–48h to reach the recipient bank account.

**Status vocabulary (uppercase, on payout records):**
- `QUOTE` — quote created, awaiting initialization
- `INITIATED` — initialized, awaiting finalize
- `PENDING` — finalize called, pending processing
- `PROCESSING` — actively sending to recipient's bank
- `COMPLETED` — successfully delivered
- `FAILED` — bank rejected or timed out (no retry possible)
- `EXPIRED` — quote TTL exceeded before finalize

**Webhook status vocabulary (lowercase, in `payouts.*` events):**
- `initiated` — webhook for INITIATED
- `processing` — webhook for PENDING/PROCESSING
- `success` — webhook for COMPLETED
- `expired` — webhook for EXPIRED

**No failure webhook** — FAILED status is observable **only** by polling `GET /api/payouts/:id`.
Reconcile-by-polling is the authority; webhooks are a latency optimization.

**Per-certificate invariant:** Partial unique index `UQ_bitnob_payouts_active_cert`
(WHERE `status NOT IN ('failed','expired')`) enforces at most one live payout per certificate.
A failed quote can be re-quoted; only one non-terminal payout can exist at a time.

---

## On-Chain Withdrawals

**Single endpoint:** `POST /api/withdrawals` (no `GET`; reconcile via `GET /api/transactions?reference=`).

**Request** (base-unit amounts):
```json
{
  "to_address": "0x742d35Cc6634C0532925a3b844Bc8e7595f42bE5",
  "amount": "1000000",
  "currency": "USDT",
  "chain": "ethereum",
  "reference": "dkwd_<uuid>",
  "memo": "optional (Stellar only)",
  "description": "optional off-chain note"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transaction_id": "...",
    "status": "pending",
    "address": "0x742d...",
    "amount": "1000000",
    "currency": "USDT",
    "chain": "ethereum",
    "reference": "dkwd_...",
    "created_at": "..."
  }
}
```

**Key details:**
- **$10 USD minimum** — enforced client-side as `WITHDRAWAL_MIN_BASE_UNITS` (10 × 1e6) in
  `bitnob-chains.constants.ts`. No FX lookup (stablecoins tracked ~1:1 USD; non-stablecoin
  withdrawals would need live FX to evaluate the floor — see the constant's doc comment).
- **Base-unit amounts** (exception to display units rule).
- **Address format validated by Bitnob** (422 Unprocessable Entity if invalid).
- **Fee deducted from sender's balance** (recipient gets full amount).
- **Status:** `pending → submitted → completed | failed` (4 statuses, lowercase).
  - `pending` — row inserted, Bitnob not yet called
  - `submitted` — Bitnob accepted the request (remote status is `pending`)
  - `completed` — on-chain transfer settled
  - `failed` — Bitnob rejected or on-chain transfer failed
- **Idempotency:** Identical `reference` → Postgres `23505` unique-violation caught,
  returns original withdrawal (idempotent HTTP 200).
- **No `GET /api/withdrawals`** — reconcile via `GET /api/transactions?reference=dkwd_<uuid>`.

**Supported chains:** `ethereum`, `bsc` (Binance Smart Chain), `polygon`, `solana`, `tron`,
`stellar`, `bitcoin` (lowercase, required in the request).

**Webhooks:** `transfer.success` (carries `transaction_id`, `hash`, `fee`) and `transfer.failed`
(out-of-gas, revert, frozen token). See "Webhooks" section below.

**Local entity:** `bitnob_withdrawals` (mirrors payout structure; `status='pending'` on create,
transitioned to `submitted` on Bitnob acceptance, advanced to terminal by webhook or polling).

---

## Bulk Transfers (Batch Crypto Sends)

**Inline flow** (no CSV upload required for this increment):

**1. Create draft** — `POST /api/bulk-transfers`

Request:
```json
{
  "description": "Batch salary disbursement",
  "idempotency_key": "batch_<uuid>",
  "items": [
    {
      "chain": "ethereum",
      "currency": "USDT",
      "address": "0x742d35Cc6634C0532925a3b844Bc8e7595f42bE5",
      "amount": "1000000",
      "row_index": 1,
      "description": "To John"
    },
    { "chain": "solana", "currency": "USDC", "address": "...", "amount": "500000", "row_index": 2 }
  ]
}
```

Response: `{ success: true, data: { batch: { id: "...", status: "draft", total_items: 2, ... }, items: [...] } }`

**Status:** `draft` (funds NOT debited yet). Each item becomes a withdrawal internally.

**2. Confirm batch** — `POST /api/bulk-transfers/:batchId/confirm`

Request:
```json
{}
```

Response: `{ success: true, data: { batch: { status: "processing", ... } } }`

**Local state transition:** `draft → confirming` (atomic CAS before the Bitnob call) → remote
confirmation. **Irreversible:** Bitnob debits funds and begins N individual on-chain sends.
No recovery possible. A failed/lost `confirm` response leaves the batch at `confirm_uncertain`
(never reverted to `draft`) — only an explicit reconcile resolves it.

**3. Retry failed items** (optional) — `POST /api/bulk-transfers/:batchId/retry`

Request:
```json
{
  "item_ids": ["<item-uuid>", ...]
}
```

Retries only items with `status='failed'`. Uses atomic `failed → processing` CAS before the
Bitnob call. Bitnob does NOT re-check each item's Bitnob status before re-sending (security
risk, see `docs/KNOWN_ISSUES.md` § "production-gate-lift blockers" #3).

**Batch status vocabulary (lowercase):**
- `draft` — created, awaiting confirm
- `confirming` — local-only transient, set by atomic `draft → confirming` CAS immediately
  before the Bitnob confirm call (prevents concurrent double-disbursement)
- `confirm_uncertain` — local-only, the confirm call threw after the CAS (network error,
  lost response, non-HTTP failure); never reverted to `draft` (no idempotency key);
  only reconcile can resolve it
- `pending` → `processing` → `completed | failed` → (mirrors Bitnob's batch status, lowercased)
- `cancelled` — user-initiated cancel (not implemented in this increment)

**Item status vocabulary (lowercase):**
- Persisted as plain `status: string` varchar, no enum
- `pending` (default on create) → `processing` (on retry) → `confirmed` (success from Bitnob) | `failed`

**Amount units:** UNVERIFIED (sandbox bulk writes return 403 "Feature Not Enabled"). Chose
base-units for consistency with withdrawals; see `docs/KNOWN_ISSUES.md` for the caveat.

**Idempotency:** `idempotency_key` (not `reference`). Bitnob dedupes by this key — identical
keys return the existing draft.

**Webhooks:** Each item → its own `transfer.success` / `transfer.failed` (unverified, assumed
from the fact that items are withdrawals). See `docs/KNOWN_ISSUES.md` § #4 (bulk item identity unverified).

**Local entities:** `bitnob_bulk_batches` (batch row), `bitnob_bulk_batch_items` (N item rows).

---

## Webhooks (Inbound Event Verification)

Bitnob delivers events to a **global dashboard webhook URL** (set once in the Bitnob console).
Each event carries an `x-bitnob-signature` header that must be verified before any state change.

**Guard:** `BitnobWebhookSignatureGuard` (`src/modules/bitnob/guards/bitnob-webhook-signature.guard.ts`)
runs before any handler.

**Signature scheme** (DIFFERENT from outbound HMAC):
- **Algorithm:** HMAC-SHA512 (not SHA256)
- **Data:** Raw request body (not parsed, not sorted) — requires `rawBody: true` in `main.ts`
- **Key:** `BITNOB_WEBHOOK_SECRET`, falling back to `BITNOB_CLIENT_SECRET`
- **Header:** `x-bitnob-signature` (lowercase, case-insensitive in HTTP)
- **Encoding:** Hex digest, no prefix

**Guard behavior:**
- Valid signature: sets `request.bitnobSignatureValid = true`
- Invalid signature: returns `401 Unauthorized` (tampered payload rejected)
- No secret set + development: persists the event with `signature_valid=false` and a loud warning,
  but does **not** dispatch it to any payout/transfer handler (M2 — an unverified event never
  mutates a money row). Event is preserved for later manual inspection.
- No secret set + production: returns `401` (prod-unsafe to skip verification)

**Webhook envelope:**
```json
{
  "event": "payouts.initialized",
  "event_id": "evt_abc123...",
  "data": {
    "id": "...",
    "status": "initiated",
    ...
  }
}
```

**Key fields:**
- `event` — event name (e.g., `payouts.initialized`, `transfer.success`), NOT `event_type`
- `event_id` — unique dedup ID (top-level, NOT in `data`), used by `BitnobWebhookService` to skip duplicate deliveries (store in `bitnob_webhook_events`, unique constraint on `event_id`, Postgres `23505` unique-violation caught and returned as idempotent HTTP 200)

**Dispatch logic** (`src/modules/bitnob/services/bitnob-webhook.service.ts`):

1. Guard verifies signature (rejects 401 if invalid)
2. Controller calls `BitnobWebhookService.handleWebhook(event, eventId, data)`
3. Persist to `bitnob_webhook_events` (event_id unique → Postgres `23505` caught, idempotent HTTP 200)
4. Dispatch by `event` name (namespaced):
   - `payouts.*` → `dispatchPayoutEvent` (maps to `PAYOUT_EVENT_STATUS_MAP`)
   - `transfer.*` → `dispatchTransferEvent` (maps to `TRANSFER_EVENT_STATUS_MAP` — withdrawals only, per M4)
   - `card.*` / `cards.*` → persisted only (stubs)
   - Anything else → persisted only

**Payout events** (mapped to local status):
- `payouts.initialized` → local `initiated`
- `payouts.processing` → local `processing`
- `payouts.withdrawal.success` → local `completed`
- `payouts.withdrawal.expired` → local `expired`

**Transfer events** (withdrawal only, Increment 5):
- `transfer.success` → local `completed`, stores `tx_hash` + `network_fee`
- `transfer.failed` → local `failed`

**Forward-only rank guard:** A webhook NEVER regresses a terminal status. Once a payout/withdrawal
is `completed` or `failed`, no webhook flips it back. This prevents double-sends if a webhook
delivery is reordered.

**Reconcile-is-authority:** Webhooks are latency optimizations ONLY. For any money decision
(release funds, mark paid, etc.), always **reconcile by polling**:
- Payouts: `GET /api/payouts/:id` (get remote status)
- Withdrawals: `GET /api/transactions?reference=dkwd_<uuid>` (find the withdrawal)

---

## Lightning pay-in: sandbox findings

**IP allowlist.** Signed read-only calls (`GET /api/whoami`, `/api/balances`, `/api/lightning/invoices`,
`/api/customers`, same HMAC signing as `bitnob-hmac.util.ts`) from an address that is not allowlisted return HTTP 403
with `code: FORBIDDEN`, `type: .../errors/FORBIDDEN` and the detail **"IP address not whitelisted"**. Once the dev IP
range is added in the dashboard, they answer 200: `whoami` (sandbox, `auth_method: hmac`, `active: true`), `balances`
(BTC, USDC, USDT accounts) and the Lightning invoice and customer lists.

**Consequence.** Bitnob enforces an IP allowlist on API credentials, sandbox included. It affects **every** call
the backend makes (payouts, withdrawals, reads and the Lightning pay-in), not only Lightning.

- Dev: add the machine's public egress IP in the Bitnob dashboard (the address a service such as
  `https://api.ipify.org` reports). A home connection can change address, which brings the 403 back. If an IPv4
  entry does not fix it, the machine may be reaching Bitnob over IPv6: add that address too. The Docker container
  leaves through the host's public IP.
- Production: the server needs a **static egress IP** (VPS or NAT gateway) before the first real call.
- Where to set it in the dashboard: not confirmed.
- Use the narrowest range that works. A `/8` range (about 16 million addresses) was used to unblock the sandbox; it
  defeats the purpose of an allowlist, so narrow it to the single address (`/32`) before real credentials are used.

**Payout beneficiary variables (`BITNOB_PAYOUT_BENEFICIARY_*`).** They describe the bank account that receives the
certificate payout (the organization's account). They are server-side only: the payout API carries no beneficiary.
Checked read-only against Bitnob: the configured country (`NG`) is in `GET /api/payouts/supported-countries`
(111 countries) and the configured bank code (`000014`) is listed by `GET /api/payouts/banks/NG` as Access Bank, so the
sandbox values are valid. The account number and name were not checked.
These four variables are **absent from the local `.env`, `.env.test` and `.env.prod`**: until a
beneficiary is configured again, creating a payout for a certificate fails with a 500 (boot only logs a warning). The
account details used as test fixtures in the Jest specs were replaced with obviously fake values. Longer term, a single
global beneficiary does not fit several administrations: the settlement account should belong to each organization.
Senegal (`SN`) is supported by Bitnob, but as **mobile money** (networks `orange`, `free`, `expresso`, `wave`, phone
number matching `^(\+?221[7]\d{8}|[7]\d{8})$`, plus a `sender` block) or **SWIFT**, and `GET /api/payouts/banks/SN`
returns no local banks. The four variables describe a bank account (account number, name, bank code, country), so paying
out in Senegal would need a mobile-money payload: to be checked in the payout service before choosing it.

**Lightning pay-in: reconciliation loop.**
The code includes `BitnobInvoiceReconcilerService` (`src/modules/bitnob/services/bitnob-invoice-reconciler.service.ts`), a background reconciliation loop that:
- Runs every `BITNOB_INVOICE_RECONCILE_INTERVAL_MS` milliseconds (default 60 000 ms = 1 min; configurable 5 000–86 400 000 ms; 0 = disabled).
- Reads pending Bitnob invoices from the local table `lightning_invoices` (entity `LightningInvoice`, filtered on `provider = 'bitnob'` and `status = 'pending'`). Batch of 50: the 25 most recent plus the 25 oldest (`LightningInvoicesService.listPendingByProvider`), so an old invoice is never starved; warns if the batch is full.
- Calls `settleIfPaid()` on each, which re-reads the invoice from Bitnob and marks it paid if the status changed.
- Isolation: errors on one invoice do not block the rest; local anti-overlap guard (one concurrent instance only).
- Disabled if `NODE_ENV=test` or the interval is 0.
- **Single-instance recommendation:** only one backend instance should run the reconciler at a time (lock-free design; multiple instances re-read the same invoices harmlessly, but it is wasteful).
- This covers the gap: if a webhook fails or is delayed, the invoice is still settled by the next reconcile pass.
- Webhook: a `transfer.*` event that does not match a withdrawal tries `dispatchLightningInvoiceSignal` before concluding unknown, so a `transfer.success` carrying a Lightning invoice ID is processed. The webhook never marks paid directly; `settleIfPaid` is the only writer.

**Lightning pay-in contract, verified against the live sandbox** (create, decode and get calls
made from the dev machine; field list cross-checked with the Bitnob docs at `bitnob.dev/api-reference/lightning`).

| Call | Route | Notes |
|---|---|---|
| Create invoice | `POST /api/lightning/invoices` | Body: `amount` (**satoshis**, 1 to 20 000 000, required), `description` (required), `reference` (required, idempotency key), `expiry` (seconds, default 86 400), `customer_id` (**optional**). HTTP 201. |
| Get invoice | `GET /api/lightning/invoices/:id` | HTTP 200. |
| List invoices | `GET /api/lightning/invoices` | `data.invoices[]`, `total_count`, `page`, `page_size`. |
| Decode BOLT11 | `POST /api/lightning/decode` | Body `{ request }`. Returns `payment_hash`, `amount_sat`, `amount_msat`, `expires_at`, `is_expired`. |
| Preview / pay | `POST /api/lightning/preview`, `/pay` | **Disabled in this sandbox**: HTTP 403 "Feature Not Enabled" (`feature_key: send_lightning`). Receiving works, sending does not. |

Create-invoice response (`data`): `id` (uuid), `payment_hash` (64 hex), `request` (the BOLT11 string), `amount_sat` (string),
`description`, `status`, `expires_at`, `created_at`. Get/list add `amount_msat`, `fee_sat`, `preimage`,
`direction: "incoming"`, `customer_id`, `reference` (our key, echoed back). **Quirks:** `expires_at` is an ISO timestamp on
create but a **Unix seconds string** on get/list; `updated_at` can be an empty string.

- **Unit:** `amount` is satoshis. Confirmed by decoding: `amount: 1000` gave `lnbc10u...` and `amount_sat: "1000"`, `amount_msat: "1000000"`.
- **Statuses** (docs): `pending`, `paid`, `expired`, `failed`. Only `pending` was observed live.
- **No customer needed.** An invoice created without `customer_id` works (HTTP 201). A test customer was also created
  (`DioteKo Collections`, `@test.invalid`); it is not used by the code.
- **Invoice prefix `lnbc`** is the Bitcoin mainnet prefix, even with sandbox credentials. Do not assume a sandbox invoice
  is harmless to pay from a real wallet until Bitnob confirms what network it settles on.

**Webhooks.** The delivery envelope is documented (`event`, `event_id`, `data`; header `x-bitnob-signature` = HMAC-SHA512;
up to 3 retries with exponential backoff; deduplicate on `event_id`; Bitnob recommends also **querying** so a failing
webhook never loses a payment; source IPs 18.171.51.218 and 13.134.154.133, subject to change). The docs say Lightning and
deposit event families exist but **do not name the "invoice paid" event**. It must be observed from a real delivery.
The backend therefore does not depend on the name. `BitnobWebhookService.dispatchLightningInvoiceSignal` looks the
payload up among OUR Bitnob invoices, in this order: `data.id` or `data.invoice_id` (Bitnob external id), then
`data.payment_hash`, then `data.invoice` (the BOLT11 string). A match is only a **signal**: `BitnobInvoiceSettlementService.settleIfPaid`
reads the invoice from Bitnob before anything is marked paid. The `reference` (`dkinv_<request id>`, with a `_<n>` suffix
after an expired attempt) is only the idempotency key sent at creation: the webhook does **not** search by it.

**Settling an invoice in the sandbox: method unconfirmed.**
- Sending Lightning is disabled in the sandbox (`POST /api/lightning/pay` returns 403 `send_lightning`).
- The documented route `POST /api/payouts/simulate-address-deposit` returns 405 Method Not Allowed (the path is captured by the route `/api/payouts/:id`), and other guessed paths (`/api/lightning/simulate`, `/api/lightning/invoices/:id/simulate`) return 404.
- The official docs (§ "Testing, Simulation, and Building in Sandbox") describe `POST /api/payouts/quotes/{quoteId}/deposits` for simulating on-chain **payout** deposits (not Lightning), and only for quotes with `source: onchain`. Not tested.
- An end-to-end test therefore needs a **real Lightning wallet** paying a small invoice, which raises the mainnet prefix question above (see the sandbox findings above).
- Code does not depend on knowing the webhook event name (it signals, then reads the invoice from Bitnob); a simulated webhook cannot replace it because the backend confirms the status before marking anything paid.
- Jest specs stub the read; no live webhook with a `paid` invoice has been observed yet.
- **Questions for Bitnob (Discord/support):** (1) How to pay or simulate paying a sandbox Lightning invoice created by `POST /api/lightning/invoices`? (2) Activate `send_lightning` for the sandbox. (3) Name and payload of the event fired when a Lightning invoice is paid?

## Module Layout

```
src/modules/bitnob/
  services/
    bitnob-hmac.util.ts              — HMAC-SHA256 signing + buildAuthHeaders
    bitnob-http-client.service.ts    — axios wrapper; BitnobApiError class inside
    bitnob-identity.service.ts       — whoami, upsert client metadata
    bitnob-balances.service.ts       — read-only balances
    bitnob-rates.service.ts          — exchange rates
    bitnob-transactions.service.ts   — transaction history
    bitnob-payouts.service.ts        — quote, initialize, finalize, read helpers
    bitnob-withdrawals.service.ts    — on-chain crypto (Increment 4)
    bitnob-bulk-transfers.service.ts — batch transfers (Increment 4)
    bitnob-webhook.service.ts        — event dispatch by type
  controllers/
    bitnob-identity.controller.ts    — GET /whoami (@Roles(ADMIN))
    bitnob-read.controller.ts        — balances, rates, transactions (@Roles(ISSUER, ADMIN, VERIFIER))
    bitnob-money.controller.ts       — payouts, withdrawals, bulk (@Roles(ADMIN))
    bitnob-webhooks.controller.ts    — POST /webhooks/* (@Public() + signature guard)
  guards/
    bitnob-webhook-signature.guard.ts — x-bitnob-signature HMAC-SHA512 verification
  common/
    bitnob-envelope.util.ts          — unwrapBitnob() → unwrap { success, data }, throw on error
  dto/
    *.dto.ts                         — input/output shapes (camelCase)
  entities/
    bitnob-*.entity.ts               — TypeORM row models (snake_case DB columns)
  payouts.util.ts                    — status helpers, PAYOUT_STATUS_RANK, terminal helpers
  payouts.constants.ts               — (optional, if needed)
  withdrawals.util.ts                — status helpers, WITHDRAWAL_STATUS_RANK, terminal helpers
  bitnob-chains.constants.ts         — supported chains, currencies, amount limits
  bitnob.module.ts                   — module registration
```

**Controller mount order matters:** `BitnobReadController` must be registered before
`BitnobMoneyController` (HTTP route matching is first-match-wins; more specific routes on
`BitnobMoneyController` can shadow general ones on `BitnobReadController`).

**DTO design — camelCase at the app boundary, snake_case on the wire:** Input/controller DTOs
are camelCase (backend-nest convention); the service builds the snake_case wire body explicitly
from validated fields (never `post(path, dto)` blindly). Orchestration-only fields (`organizationId`,
`subjectDidId`) are a separate service argument that is consciously *not* forwarded.

**Deferred families (stubs only, no write paths):**
Trading, cards, customers, beneficiaries, Bitnob Lightning — entities remain in the schema,
read helpers are stubbed, no write paths implemented. See `docs/DECISIONS.md`.

---

## Money-Safety Model

Every money-moving call follows this sequence:

**1. Prod gate (first line)**
```typescript
if (this.environment() === 'production') {
  throw new ForbiddenException('Bitnob money-move disabled in production (Increment X interim state)');
}
```
Where `environment()` is a private helper that reads `config.get('bitnob.environment')`.

Increments 1–5: The following methods all throw in prod:
- `BitnobPayoutsService.finalizePayout` (disbursement step)
- `BitnobWithdrawalsService.createWithdrawal` (on-chain send)
- `BitnobBulkTransfersService.createDraft` (batch creation)
- `BitnobBulkTransfersService.confirmBatch` (irreversible batch disbursement)
- `BitnobBulkTransfersService.retryItems` (retry failed items)

**2. Persist locally (in a transaction)**
```typescript
// Create row BEFORE external call, with a deterministic reference
const payout = await dataSource.transaction(async (manager) => {
  const row = manager.create(BitnobPayout, {
    reference: `dkpayout_${id}`,
    status: 'quote',
    // ... other fields
  });
  return manager.save(row);
});
```

**3. Build wire body explicitly**
```typescript
const wirePayload = {
  from_asset: dto.fromAsset,
  to_currency: dto.toCurrency,
  // ... validated fields only, NOT organizationId, NOT subjectDidId
};
const payload = JSON.stringify(wirePayload);
```

**4. Call Bitnob (with the signed payload)**
```typescript
const response = await this.httpClient.post('/api/payouts/quotes', payload);
const payout = unwrapBitnob(response);
```

**5. Update local row (atomic CAS on status)**
```typescript
// For payouts, finalize uses a CAS check before calling Bitnob:
const current = await repo.findOne({ id: payout.id });
if (current.status !== 'initiated') {
  throw new ConflictException('Payout no longer in initiated state');
}
// Poll Bitnob before finalize (reconcile-is-authority)
const remote = await this.getPayout(payout.id);
if (remote.status !== 'INITIATED') {
  // Sync local without calling finalize
  current.status = 'processing'; // or other remote status
  await repo.save(current);
  return;
}
// Finalize (the money-move call)
await this.httpClient.post(`/api/payouts/${quoteId}/finalize`, '{}');
current.status = 'processing';
await repo.save(current);
```

**6. Error handling**
- On Bitnob error, **do NOT revert** the local row created in step 2 — keep it for audit.
- **Scrub PII** before persisting `raw_result` (no account numbers, masked data only).
- Log action + entity ID only, never secret/address/amount details.

**Revert-on-failure differences:**
- **Payouts `finalize`:** Re-polls `GET /api/payouts/:id` as an extra check; if remote status
  changed, reverts the local `finalizing` transient state back to the last-known terminal status.
  Does NOT revert the `initiating` row (both are persisted for audit).
- **Bulk `confirm`:** Does NOT revert on Bitnob error (confirms are irreversible — no idempotency
  key in the Bitnob spec). Once `confirm` succeeds remotely, any retry is a double-send.

**Access logging:** Both payouts and withdrawals write an `access_logs` row with the acting
admin's user ID to record the money-touching operation. Action names:
- **Payouts:** `action: AccessLogAction.PAYOUT` (quote, initialize, finalize)
- **Withdrawals:** `action: AccessLogAction.WITHDRAWAL` (create, reconcile)
- **Bulk transfers:** `action: AccessLogAction.BULK_TRANSFER` (create draft, confirm, retry)

---

## Config / Environment Variables

**Bitnob connection:**

| Var | Type | Default | Notes |
|---|---|---|---|
| `BITNOB_CLIENT_ID` | string | *required* | Bitnob account client ID (UUID) |
| `BITNOB_CLIENT_SECRET` | string | *required* | API secret for signing requests; prod secret contains `prd:` prefix |
| `BITNOB_BASE_URL` | string | `https://api.bitnob.com` | Base URL (same for sandbox + prod) |
| `BITNOB_ENVIRONMENT` | string | *required* | `sandbox` or `production` — gating flag for money moves |
| `BITNOB_WEBHOOK_SECRET` | string | (falls back to `BITNOB_CLIENT_SECRET`) | Secret for verifying `x-bitnob-signature` webhooks |
| `BITNOB_INVOICE_RECONCILE_INTERVAL_MS` | number | `60000` | Reconciler loop interval (milliseconds); `0` = disabled; min 5000, max 86 400 000 |

**Payout beneficiary** (Increment 3 interim — env-configured, not caller-supplied):

| Var | Type | Required | Notes |
|---|---|---|---|
| `BITNOB_PAYOUT_BENEFICIARY_ACCOUNT_NUMBER` | string | yes (for payouts) | Bank account number |
| `BITNOB_PAYOUT_BENEFICIARY_ACCOUNT_NAME` | string | yes (for payouts) | Account holder name |
| `BITNOB_PAYOUT_BENEFICIARY_BANK_CODE` | string | yes (for payouts) | Bank code (varies by country/corridor) |
| `BITNOB_PAYOUT_BENEFICIARY_COUNTRY` | string | yes (for payouts) | ISO-2 country code |

**Application callback URL** (for payout webhooks):

| Var | Type | Required | Notes |
|---|---|---|---|
| `APP_BASE_URL` | string | yes | Public HTTPS URL (e.g., `https://api.dioteko.com`); used to build webhook callback URLs |

All vars are validated at boot by `src/config/env.validation.ts`; missing required vars abort startup.

---

## See Also

- **`docs/DECISIONS.md`** — Why these design choices were made  - HMAC wire-byte signing
  - DTO casing strategy
  - 3-step payout with deferred finalize
  - Production gate
  - Per-certificate idempotency
  - Env-configured beneficiary
  - ADMIN-only raw routes
  - Families deferred
  - Whoami persistence
  - Webhook signature + reconcile-as-authority
  - Bulk webhook deferral
  - M#/A# review-gate convention

- **`docs/KNOWN_ISSUES.md`** — Outstanding issues and sandbox limitations
  - Bitnob API contract verified (but some details unconfirmed in sandbox)
  - Sandbox limitations (bulk writes 403, no stablecoin balance, no beneficiary validation)
  - Production-gate-lift blockers (8 items, split by blocking/acceptable)
  - Webhook secret unconfirmed
  - Withdrawal idempotency key missing (raw endpoint)
  - Bulk `retryItems` re-poll missing
  - Bulk item webhook identity unverified

- **`docs/SCHEMA.md`** — Table structure
  - `bitnob_payouts` (status, reference, certificate link)
  - `bitnob_withdrawals` (address, amount, chain)
  - `bitnob_bulk_batches` (batch-level status and totals)
  - `bitnob_bulk_batch_items` (per-item status and withdrawal ID)
  - `bitnob_webhook_events` (persisted deliveries, event_id dedup)
  - `bitnob_clients` (identity metadata)

- **`docs/BUSINESS_RULES.md`** — Money lifecycle rules (roles, state transitions)

- **`docs/IMPLEMENTATION_NOTES.md`** — Bitnob webhook event routing (namespaced keys, dispatch logic)
