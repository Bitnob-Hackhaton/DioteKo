---
name: bitnob-docs
description: Where Bitnob's live API docs live and how to fetch them (docs.bitnob.com -> bitnob.dev), URL patterns, WebFetch limitations
metadata:
  type: reference
---

Bitnob published docs:

- `docs.bitnob.com/*` returns **301 -> `bitnob.dev/*`** (same path). WebFetch reports the
  redirect; re-issue against the `bitnob.dev` URL.
- API reference base: `https://bitnob.dev/api-reference`
- Section index pages that render for WebFetch:
  `https://bitnob.dev/api-reference/{section}` where section in:
  authentication, wallet-infrastructure, transactions, wallets, withdrawal, addresses,
  virtual-accounts, virtual-cards, payouts, trading, exchange-rates, lightning,
  customers, beneficiary
- Some deep endpoint pages resolve (`/api-reference/payouts/list-payouts`,
  `/api-reference/payouts/account-lookup`), many guessed slugs 404. The section index
  page usually already contains the per-endpoint fields.
- Guides: `https://bitnob.dev/docs/{genesis|bitcoin|stablecoins|payouts|...}` and
  `https://bitnob.dev/docs/changelogs`. API best practices sub-pages under
  `/docs/genesis/api-best-practices/*`.
- API base URL: `https://api.bitnob.com` (same for sandbox and production; environment is
  determined by which credentials you use).

WebFetch limitation: the docs site is a JS/SPA. WebFetch reliably returns endpoint paths,
param names, and field lists, but **often cannot retrieve the literal "Sample Response"
JSON blocks or the error-handling prose**. For full response bodies fall back to the
Postman collection in the repo, or the Swagger explorer / Playground.
