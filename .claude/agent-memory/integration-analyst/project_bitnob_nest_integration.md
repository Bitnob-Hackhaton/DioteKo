---
name: bitnob-nest-integration
description: Incremental plan used to wire the Bitnob API into backend-nest/src/modules/bitnob (HMAC, read endpoints, payouts, withdrawals/bulk, webhooks)
metadata:
  type: project
---

DioteKo is wiring the real Bitnob API into `backend-nest/src/modules/bitnob/` in increments.

**Why:** Bitnob is the payment rail of the NestJS backend (`.claude/CLAUDE2.md`). The real API
paths are `/api/...` with no `v1` prefix.

**How to apply:**
- Increment 1: HMAC signing verified against live sandbox.
  `bitnob-hmac.util.ts` + `bitnob-http-client.service.ts` are confirmed correct. Smoke
  script hit whoami/balances/exchange-rates live.
- Increment 2: read endpoints — whoami (+persist to
  `bitnob_clients`), balances, exchange-rates, transactions. Contract verified — see
  [[bitnob-api-contract]].
- Increment 3: read-only payout helpers (supported-countries,
  banks, limits, account-lookup, list/get payouts) + the 3-step WRITE path
  (quote -> initialize -> finalize). Contract in [[bitnob-api-contract]] "Payout WRITE
  flow" section. Open items flagged there need a one-off manual sandbox call by the
  coordinator before the write code is finalised.
- Increment 4: on-chain withdrawals (`POST /api/withdrawals`,
  1 table `bitnob_withdrawals`) + bulk transfers (`POST /api/bulk-transfers` draft ->
  `/:batchId/confirm`, 2 tables `bitnob_bulk_batches` + `bitnob_bulk_batch_items`).
  Contract + open probe items in [[bitnob-api-contract]] "On-chain WITHDRAWALS" and
  "BULK TRANSFERS" sections. KEY: bulk `amount` units contradiction (decimal vs base)
  unresolved; bulk is on-chain-crypto ONLY (not fiat bank); min stablecoin withdrawal
  is $10 so sandbox (~5 USDT bal) can't complete one end-to-end.
- Increment 5: webhook receiver + signature verification +
  wiring transfer.* into withdrawal/bulk status. Full webhook contract verified in
  [[bitnob-api-contract]] "WEBHOOKS — full contract" section. KEY: sig = HMAC-SHA512 hex
  no-prefix over raw body, header `x-bitnob-signature`, keyed with account API secret
  (per-account, NOT the request-signing scheme - don't reuse bitnob-hmac.util.ts); guard
  needs RAW body (Nest rawBody). transfer.* envelope `{event, event_id, data{reference,
  transaction_id, hash, fee, amount, chain, currency, timestamp}}` - match our withdrawal
  on `data.reference` (= dkwd_<uuid>), fallback `transaction_id`. transfer.failed has no
  documented reason field. Bulk: no bulk-specific event documented; items likely emit
  their own transfer.* but bulk items have NO merchant reference - reconcile via
  withdrawal_id <-> transaction_id (unverified, needs probe). Single global dashboard
  webhook URL (withdrawals take no callback_url) -> one receiver route, dispatch by event
  name. Entities need tx_hash/network_fee columns (migration). Open probes: SHA256-vs-512
  contradiction in one doc page, fee unit, transfer.failed reason field, bulk item webhook
  identity, dashboard delivery-log/resend availability.
