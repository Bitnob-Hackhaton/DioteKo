---
name: bitnob-repo-sources
description: The two in-repo references for the Bitnob integration contract (Postman collection + Increment 1 smoke script)
metadata:
  type: reference
---

Two local sources of truth for the Bitnob API contract, in repo root:

1. `bitnob_api.postman_collection.json` ("Bitnob API v2", ~5400 lines, ~400KB — too big
   to Read whole; use Grep for `"name":` to get the folder/request index, then Read line
   ranges). Contains folders: Identity, Balances, Addresses, Withdrawals, Transactions,
   Exchange rates, Trading, Bulk transfers, Virtual accounts, Cards, Lightning, Customers,
   Beneficiaries, Payouts. Every request has a saved **200 OK** sample response body
   (embedded JSON string). No error-response samples. Collection `info.description`
   (line 5) states amounts are base units and "Most error responses follow RFC 7807
   (type, title, status, detail, correlation_id, timestamp)".
   Known stale spot: `Transactions > List transactions` shows query params
   `state`/`ascending`/`limit`; live docs say `status`/`type`/`currency`/`cursor`/`limit`.

2. `bitnob-dioteko-endpoints.md` — hand-written mapping of Bitnob endpoints to DioteKo
   domains. Useful for intent, NOT authoritative on paths (predates the v2 collection).

3. Increment 1 smoke script (backend-nest) hit `GET /api/whoami`, `GET /api/balances`,
   `GET /api/exchange-rates` live against sandbox and logged real response bodies — these
   match the Postman 200 samples exactly.
