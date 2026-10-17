---
name: bitnob-api-contract
description: Verified Bitnob API v2 contract facts (paths, envelope, money units, param names) - read, payouts, withdrawals, bulk-transfers, webhooks
metadata:
  type: reference
---

Verified against `bitnob.dev/api-reference/*` + repo Postman collection +
Increment 1 smoke output. Base URL `https://api.bitnob.com`. All paths are `/api/...`
(NO `/api/v1/`).

**Response envelope (all endpoints):** `{ success: bool, message: string, data: object,
timestamp: RFC3339 }`. Newer endpoints (payouts list, cards) also include
`metadata: { request_id: string }`. Older ones (whoami, balances, transactions,
exchange-rates) had no `metadata` in the Postman samples.

**Money:** amounts are **strings in the smallest unit** per currency (USDT/USDC 1e6, BTC
sats, NGN kobo? -> NGN sample showed "0"). Each money field is paired with a
`*_formatted` string ("5.0172 USDT"). Exchange-rate values are also strings;
`valid_for_seconds` is a number.

**Read endpoints:**
- `GET /api/whoami` -> data: active(bool), active_company_id(uuid), auth_method("hmac"),
  client_id(uuid), client_name, environment("sandbox"|"live"), permissions(null|?)
- `GET /api/balances` -> data.accounts[]{account_id, account_number, currency,
  ledger_balance, available_balance, ledger_balance_formatted,
  available_balance_formatted, created_at} + data.company_id
- `GET /api/balances/:currency` -> data{account_number, currency, total_balance,
  available_balance, pending_balance, company_id}
- `GET /api/exchange-rates?from=&to=` -> data{base_currency, target_currency, buy_rate,
  sell_rate, mid_rate, inverse_rate, valid_for_seconds(num), percent_change_24h,
  timestamp}
- `GET /api/exchange-rates?base=` -> data{base_currency, rates[]{target_currency,
  buy_rate, sell_rate, inverse_rate, percent_change_24h}, skipped_currencies[](strings),
  timestamp}  (NB: no mid_rate, no valid_for_seconds in list form)
- `GET /api/exchange-rates/convert?from=&to=&amount=` -> data{from_currency, to_currency,
  from_amount, to_amount, rate_used, timestamp}. `amount` is in display units.
- `GET /api/transactions` query: `cursor`, `limit`(def 20 max 100), `type`, `status`
  (PENDING|IN_PROGRESS|SETTLED|FAILED|REVERSED), `currency`. data{transactions[],
  next_cursor, previous_cursor, total_count, has_more}. Item: transaction_id,
  account_number, currency, type, state, amount(str, signed), fee(str), reference,
  idempotency_key, trade_id, metadata(obj), created_at, updated_at, value_date,
  amount_formatted, fee_formatted, side("Debit"|"Credit").
  STALE POSTMAN: collection shows query `state`/`ascending` — live docs say
  `status`/`type`/`currency`/`cursor`.
- Payouts read: `GET /api/payouts/supported-countries`,
  `GET /api/payouts/supported-countries/:country`, `GET /api/payouts/banks/:countryCode`,
  `GET /api/payouts/limits`, `GET /api/payouts/account-lookup?country=&bank_code=&account_number=`
  (+ optional `type=mobile_money`), `GET /api/payouts?status=&limit=&offset=`
  (data{items[], total_count, limit, offset, has_more} — offset pagination, NOT cursor),
  `GET /api/payouts/:id` (data.payout{...}).
- Payout write flow: `POST /api/payouts/quotes` -> `POST /api/payouts/:quoteId/initialize`
  -> `POST /api/payouts/:quoteId/finalize`. See payout-write section below.

**Payout WRITE flow (verified, bitnob.dev/api-reference/payouts +
/docs/payouts/*):**
- Quote body: `{ country(req, ISO-2), from_asset(req: BTC|USDT|USDC), to_currency(req),
  source(req: "offchain"|"onchain" lowercase), chain(req for onchain), reference(req),
  amount OR settlement_amount (one req; if both, `amount` wins) }`. `customer_id` NOT
  required (Postman shows it; live docs omit it; KYC optional in sandbox).
- **Money units in payouts are DISPLAY units, NOT base units** (exception to the global
  rule): `settlement_amount`="5000" == ₦5,000; `amount`="3.629834" == 3.63 USDT;
  payout `limits` min/max also whole units. Minor-unit mirrors are `cent_amount` (kobo)
  and `sat_amount`/`btc_amount` (BTC side), `cent_fees`.
- Quote resp: `data.payout{ id(uuid), quote_id("QT_107325"), status:"QUOTE",
  expires_at(~15min), exchange_rate{rate, btc_rate, currency, effective_rate}, ... }`.
- Initialize body: `{ quote_id(req), reference(req), payment_reason(REQUIRED - free
  string, but some corridors enforce a fixed list; check supported-countries/:country;
  examples salary|vendor_payment|family_support), callback_url(opt, https),
  beneficiary{ destination_type(req: bank|mobile_money|swift), country(req),
  account_name(req), account_number(req), bank_code(cond - req for bank/mobile_money) } }`.
  Beneficiary field set is corridor-driven: `GET /api/payouts/supported-countries/:country`
  -> `data.destination_types.<type>.fields[]` is the source of truth.
- Finalize body: `{}` (no otp/pin). For offchain, finalize debits the business wallet.
- All 3 steps returned HTTP 200 in Postman samples (finalize status code undocumented).
- Payout record `status`: `QUOTE -> INITIATED -> PENDING -> PROCESSING -> COMPLETED|FAILED`
  (uppercase; glossary showed lowercase completed/failed - casing of terminal states
  UNCONFIRMED). Expired quote is NOT a record status: finalize past `expires_at` -> HTTP
  400 `quote_expired`.
- Webhook `data.status` is LOWERCASE event outcome (initiated|processing|success|expired),
  distinct from the record's uppercase `status`.
- callback_url: settable per-request on initialize AND/OR a global account-level webhook.
- CONTRADICTION in Bitnob's own docs: `/docs/payouts/error-handling` still names the old
  `payout.transfer.success`/`payout.transfer.failed` and says "no webhook for expiry";
  the changelog + `/api-reference/payouts/webhooks` + `/docs/payouts/webhook-payout` say
  the 4 `payouts.*` events (incl `payouts.withdrawal.expired`) replaced them. Trust the
  changelog/api-reference. **No `payouts.withdrawal.failed` is documented anywhere** in
  the new scheme - failure handling for bank rejections needs a real sandbox test.
- NEEDS REAL SANDBOX TEST (coordinator will do): double-initialize / double-finalize
  behavior; finalize success HTTP code; whether offchain finalize is synchronous;
  failure webhook name/shape; whether `customer_id` is still accepted; exact `trip`
  sub-fields; terminal status casing.

**On-chain WITHDRAWALS (verified, bitnob.dev/api-reference/withdrawal +
/docs/stablecoins/*):**
- `POST /api/withdrawals` ONLY. No `GET /api/withdrawals` or `/:id` — reconcile via
  `GET /api/transactions` (filter by `reference` / `type`); create-response
  `transaction_id` ties them.
- Body: `{ to_address(req), amount(req, BASE units - '150500000'=150.5 USDT),
  currency(req: USDT|USDC|BTC), chain(req: ethereum|bsc|polygon|solana|tron|stellar|
  bitcoin - lowercase; Postman also saw base/optimism/avalanche in sandbox),
  reference(opt but ALWAYS send - idempotency), memo(opt, Stellar), description(opt) }`.
  `chain` IS required (not inferred from currency).
- Resp data: `{ transaction_id(uuid), status, address, amount, currency, chain, reference,
  memo, description, created_at }`. NO tx_hash / fee in initial response - both arrive on
  the `transfer.success` webhook. (Stale `/docs/stablecoins/sending-stablecoins` mentions
  `centFees`/`fee`/`hash` in the response - trust api-reference: not in initial resp.)
- Status: `pending -> completed | failed` (lowercase, 3 values only). Held funds
  refunded to balance on terminal `failed`.
- Fees: network/gas fee DEDUCTED FROM BALANCE (recipient gets full `amount`), so need
  `balance >= amount + fee`. NO fee-preview endpoint.
- Address validation: `POST /api/withdrawals` validates format itself (422 if bad for
  chain). `POST /api/addresses/validate {address,chain}` -> `data{valid(bool), address,
  chain, error?}` is OPTIONAL pre-check (format only, no on-chain existence).
- Errors: 400 (bad body / unsupported currency-chain / bad address format), 401,
  402 Insufficient Funds, 409 Conflict (dup `reference` - returns the existing
  withdrawal), 422 (address invalid for chain / amount below min), 429 rate limit.
- Webhooks: `transfer.success` (carries `transaction_id`, `hash`, `fee`, `timestamp`),
  `transfer.failed` (out-of-gas, revert, frozen token, RPC). Also `deposit.success`
  (inbound). NOT `withdrawal.*`.
- CHANGELOG (BREAKING): min stablecoin withdrawal = **$10 USD**. Sandbox
  wallet holds ~5 USDT / ~3 USDC -> a real completing withdrawal CANNOT be funded in
  sandbox; a probe will hit 422 (below min) or 402 (insufficient).
- Sandbox broadcast vs simulate: UNDOCUMENTED - needs probe.

**BULK TRANSFERS (verified, bitnob.dev/api-reference/bulk-transfers):**
- On-chain ONLY (crypto `address`, not fiat bank accounts). Each item becomes a
  withdrawal (`item.withdrawal_id`). Bulk = N withdrawals, NOT N payouts.
- Inline `items[]` draft -> confirm is a COMPLETE path (no CSV needed). CSV path is
  `POST /api/bulk-transfers/upload-urls` -> S3 PUT -> `POST /api/bulk-transfers/previews`.
- `POST /api/bulk-transfers` body: `{ description(opt), idempotency_key(opt - "prevent
  duplicate batch creation"), items[]{ chain(req), currency(req: BTC|USDT|USDC),
  address(req), amount(req), row_index(opt), description(opt) } }`. Returns HTTP 201.
- **`amount` UNITS CONTRADICTION**: live api-reference says "decimal string (e.g. '0.001'
  BTC, '1500.00' USDT)" = DISPLAY units; Postman folder desc says "Amounts are in base
  units"; Postman sample used "1". Withdrawal (which items feed) is base units. UNRESOLVED
  - MUST probe.
- `POST /api/bulk-transfers/:batchId/confirm` body `{}` -> HTTP 200, status -> `processing`.
  Irreversible, debits funds. No OTP/checksum. `POST /:batchId/retry` body
  `{ item_ids: [uuid,...] }` (only `failed` items re-queued).
- `GET /api/bulk-transfers` (list, `next_page_token` cursor pagination, data.batches[]),
  `GET /api/bulk-transfers/:batchId` (data.batch + data.items[], identical to draft resp).
- Batch status (lowercase): draft, pending, processing, completed, failed, cancelled.
  Item status (lowercase): pending, processing, confirmed(=success), failed.
  Batch has `total_items`/`success_count`/`failed_count`; item has `failure_reason`,
  `retries`, `withdrawal_id`.
- Draft resp: `data{ batch{id, company_id, description, status, total_items,
  success_count, failed_count, created_at, submitted_at, completed_at},
  items[]{id, batch_id, row_index, chain, currency, address, amount, description,
  status, failure_reason, retries, withdrawal_id} }`.
- Webhooks for bulk: UNDOCUMENTED - likely per-item `transfer.success`/`transfer.failed`
  (since items are withdrawals) - needs probe.
- Schedules/Executions (`/api/bulk-transfers/schedules*`, `.../executions/:id/retry`) are
  RECURRING only - clean to skip for one-shot bulk.
- Sandbox confirm behaviour: UNDOCUMENTED - needs probe (stop before confirm).

**Error format:** NOT re-verified against live docs (SPA blocked WebFetch).
Postman `info.description` claims RFC 7807 (type, title, status, detail, correlation_id,
timestamp). No error samples in the collection. Needs a live 4xx capture to confirm.

**Rate limiting:** per-card throttles (topup 1/30s, withdrawal 1/60s, card detail 2/60s).
`POST /api/withdrawals` documents a **429 Too Many Requests**. No global limit /
Retry-After spec documented for read endpoints.

**Webhooks (payouts):** per the bitnob.dev/docs/changelogs, events are
`payouts.initialized`, `payouts.processing`, `payouts.withdrawal.success`,
`payouts.withdrawal.expired` — they replaced the old `payout.transfer.*` events. `payouts.processing`
is non-terminal.

**WEBHOOKS — full contract (verified)** against bitnob.dev/docs/changelogs,
bitnob.dev/docs/webhooks/payouts-webhook, bitnob.dev/api-reference/payouts/webhooks,
bitnob.dev/api-reference/withdrawal/webhooks,
bitnob.dev/docs/stablecoins/handling-webhooks-for-stablecoin-transfers, plus web search
of the "Verifying Events" code sample. NOTE: the docs SPA would not return verbatim JSON
payload blocks or the code sample source — field lists are assembled from the rendered
field tables + changelog prose. `docs.bitnob.com/docs/webhooks` 301s to a now-404
`bitnob.dev/docs/webhooks` (Bitnob's redirect is broken) — the live content is on the
per-family pages above.

- **Signature header:** `x-bitnob-signature` (lowercase; HTTP header, treat case-insensitive).
  VERIFIED (payouts-webhook + api-reference/withdrawal/webhooks + changelog).
- **Algorithm/encoding:** HMAC-**SHA512**, **hex** digest, **NO prefix**. Code sample:
  `crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex')`,
  compared to the header. VERIFIED (search of "Verifying Events" sample + changelog
  "HMAC SHA512 verification via x-bitnob-signature").
  DOCS-AMBIGUOUS: the newer prose page
  `/docs/stablecoins/handling-webhooks-for-stablecoin-transfers` shows an example header
  `X-Bitnob-Signature: sha256=5c76a3e6b7c...` (SHA256, `sha256=` prefix) that contradicts
  the code sample + changelog + api-reference. Treat SHA512/hex/no-prefix as authoritative;
  the SHA256 example looks like copied boilerplate. A live sandbox delivery resolves it.
  NB: this is a DIFFERENT scheme from our REQUEST signing (that is HMAC-SHA256 hex over
  `clientId:ts:nonce:payload`) — the webhook guard must NOT reuse `bitnob-hmac.util.ts`.
- **Signing key:** "your secret key" / "your API secret" / "secret in your dashboard".
  DOCS-AMBIGUOUS whether this is the same account API `client_secret` used for request
  signing or a distinct dashboard-generated webhook secret. All three doc pages phrase it
  as the account secret and none mention a per-endpoint secret → assume **per-account**,
  and most likely **the same API secret**. Safest impl: read it from its own config var
  (`BITNOB_WEBHOOK_SECRET`) defaulting to the API secret, so a separate value can be
  dropped in without code change. A dashboard look or Bitnob-support question resolves it.
- **What is signed:** the JSON body only (`JSON.stringify(body)`). NO timestamp header,
  NO timestamp-in-signature, NO documented replay-tolerance window. Replay defense =
  idempotency on the top-level `event_id` (see envelope). VERIFIED (code sample shape) /
  NOT-FOUND (timestamp/replay — none documented; assume none).
  IMPL RISK: Bitnob signs their exact serialization. `@Body()` in Nest is already
  parsed; re-`JSON.stringify` can reorder keys / change whitespace → signature mismatch.
  The guard needs the RAW request body (Nest `rawBody: true` or a raw-body middleware
  scoped to the webhook route), not the parsed object.
- **Delivery topology:** ONE global webhook URL configured in the dashboard
  ("you can update the webhook URL setting on your dashboard"). Payout `initialize` also
  accepts a per-request `callback_url`. Withdrawals (`POST /api/withdrawals`) and
  bulk-transfers have **NO `callback_url` param** → `transfer.*` events are delivered
  ONLY to the global dashboard URL. Whether multiple URLs or per-event-family routing is
  supported: NOT-FOUND (assume single global URL; all event families land on it).
  Source IPs (per changelog): `18.171.51.218`, `13.134.154.133` — allowlist
  optional, signature check still required.
- **`transfer.*` events:** `transfer.success`, `transfer.failed` (outbound withdrawals);
  `deposit.success` (inbound, ignored by our dispatch). NOT `withdrawal.*`. VERIFIED
  (api-reference/withdrawal/webhooks + changelog).
  - Envelope: `{ event, event_id, data: { ... } }`. Top-level `event_id` added per changelog
    ("refreshed webhook payloads ... to include a top-level `event_id`").
    `event` value is the literal event name (`"transfer.success"`). DOCS-AMBIGUOUS on
    exact nesting depth (SPA render flattened `data`); lean `{event, event_id, data}`.
  - `data` fields (from the rendered field table): `address`, `amount` (string, smallest
    unit), `chain`, `currency` (USDT|USDC|BTC), `fee` (string), `hash` (on-chain tx hash),
    `reference` (merchant reference), `timestamp` (ISO-8601). `transfer.success` also
    carries `transaction_id` in `data` (changelog, explicit).
  - (a) MATCH FIELD: `reference` — we always send `reference = dkwd_<uuid>` on create.
    Fallback `transaction_id` (we persist the create-response `transaction_id`). VERIFIED.
  - (b) tx hash field: `hash`. VERIFIED.
  - (c) fee field: `fee` (string). UNIT: DOCS-AMBIGUOUS — `amount` is documented as
    "smallest currency unit"; `fee` unit not stated (base unit of the withdrawal currency
    vs native gas token). Increment 4 contract: gas fee is deducted from balance, not the
    recipient amount. A live `transfer.success` resolves the unit.
  - (d) `status` field: NOT-FOUND on transfer events — the event NAME is the outcome.
    Don't look for `data.status`; branch on `event`.
  - (e) failure reason on `transfer.failed`: NOT-FOUND — no documented `reason`/`error`
    field. Docs only give prose causes (out of gas, revert, invalid address, RPC). Store
    the raw payload; a live `transfer.failed` shows whether a reason field exists.
- **Bulk-transfer events:** NOT-FOUND — no batch-level or bulk-specific webhook is
  documented. Each bulk item becomes a withdrawal, so each item most likely emits its own
  `transfer.success` / `transfer.failed`. PROBLEM: bulk item bodies carry NO per-item
  merchant `reference` (Increment 4: item = `{chain, currency, address, amount, row_index,
  description}`), so item webhooks can only be reconciled via `withdrawal_id` ↔ webhook
  `transaction_id`/`reference`. Whether the webhook `transaction_id` equals the item's
  `withdrawal_id` is UNVERIFIED — needs a sandbox bulk probe.
- **Payout event envelope:** `{ event, event_id, data: { id, quote_id, company_id,
  reference, status (lowercase: initiated|processing|success|expired), from_asset (lc),
  to_currency (lc), amount, settlement_amount, fees, beneficiary{country, bank_code,
  masked account_number}, created_at, updated_at } }`; success/expired add `completed_at`;
  expired adds `payment_reason`. `data.status` != the uppercase Get-Payout lifecycle
  status. VERIFIED (payouts-webhook + api-reference/payouts/webhooks). No `payouts.*.failed`
  event still documented (matches prior finding).
- **Envelope key names:** event name key is `event` (NOT `event_type`); dedup id key is
  `event_id` (top-level, NOT in `data`). Our `extractEventType` (`event_type ?? eventType
  ?? event`) and `extractEventId` (`id ?? event_id ?? eventId`) both fall through to the
  right key, but `event`/`event_id` are the real ones.
- **Retry:** DOCS-AMBIGUOUS. api-reference/withdrawal/webhooks + the code-sample page:
  "if the response code is not 200, we retry 3 times after the first failure" (≈4 attempts,
  schedule unspecified). Newer stablecoins prose: "retried with exponential backoff",
  "must respond 2xx within 5 seconds". Safe impl: respond 200 fast (<5s), make dispatch
  idempotent on `event_id`, expect up to ~4 attempts. Response body: not specified (200
  status is what matters). Our controller already returns `{received:true}` 200 even when
  dispatch throws — consistent with "a non-200 just gets the same unresolvable payload
  retried".
- **Replay/inspect deliveries in dashboard:** NOT-FOUND — docs only say the webhook URL is
  editable in the dashboard. A delivery log / manual resend is not documented; the
  coordinator should check the sandbox dashboard directly for the manual-verification step.
- **Local entities:** `bitnob-withdrawal.entity.ts` and `bitnob-bulk-batch-item.entity.ts`
  had no `tx_hash` / `network_fee` columns, only `raw_result` jsonb. To make those values
  queryable rather than buried in `raw_result`, they need nullable `tx_hash` + `network_fee`
  columns on `bitnob_withdrawals` (and ideally `bitnob_bulk_batch_items`); check
  `docs/DATABASE_MODEL.md` for the current columns.
