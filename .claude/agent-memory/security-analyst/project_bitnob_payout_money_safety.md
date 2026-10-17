---
name: bitnob-payout-money-safety
description: backend-nest Bitnob payout (money-out) review checklist and the authz model — staff org scope read from the DB, beneficiary resolved server-side (JwtPayload carries no organizationId)
metadata:
  type: project
---

The Bitnob payout flow in `backend-nest/src/modules/bitnob/` + the
`createBitnobPayoutForCertificate` path in `admin-certificates` moves real fiat
(3-step Bitnob contract: `POST /api/payouts/quotes` -> `/initialize` -> `/finalize`;
`finalize` is the disbursement trigger). `BitnobService.executePayout` is a live money mover.

**Authorization model (load-bearing for every money-out review):**
- `backend-nest/src/common/interfaces/jwt-payload.interface.ts` = `{ sub, roles, did? }` —
  NO `organizationId`. `RolesGuard` checks role membership only; `issuer` is a shared staff role.
- The staff organisation scope is therefore read from the database: `createBitnobPayoutForCertificate` resolves the
  actor's organisation (`resolveActorOrganizationId`) and returns 404 for a certificate of another organisation.
- The payout beneficiary is server-resolved (`resolvePayoutBeneficiary`, from `BITNOB_PAYOUT_BENEFICIARY_*`), never
  caller-supplied. A caller-supplied bank account would let any issuer drain the treasury: block any change that
  reintroduces one. See `project_admin_certs_org_scoping.md`.

**Review checklist for any Bitnob payout / money-out change:**
1. Is the destination account server-derived (config) or caller-supplied? Caller-supplied = block unless ADMIN-only + non-prod asserted.
2. Is `finalize` deferred out of the create request path (so one HTTP call never chains to irreversible money-out)? It should be a separate admin call that pre-polls `GET /api/payouts/:id` and only finalizes if local status=`initiated` AND Bitnob status=`INITIATED`.
3. Deterministic idempotency key? Bitnob's `reference` is the ONLY idempotency mechanism. `crypto.randomUUID()` per call defeats it on retry. Want: persist row first -> `reference` from row id -> partial unique index on the cert ref `WHERE status <> 'failed'` -> 409 pre-check.
4. `callback_url` validated as absolute `https:` before `initialize`? There is NO Bitnob failure webhook — only polling `GET /api/payouts/:id` observes `FAILED`. The webhook is `@Public()` plus `BitnobWebhookSignatureGuard` (HMAC-SHA512 verified); a webhook must still not be the only path to a terminal payout state.
5. Sandbox vs prod: same host `api.bitnob.com`, differentiated ONLY by which API key is in env. Needs an explicit `BITNOB_ENVIRONMENT` assert. `configuration.ts` bitnob.baseUrl defaults to the PROD host.
6. PII in logs: `bitnob-http-client.service.ts` logs `JSON.stringify(responseBody)` on error — Bitnob echoes `beneficiary` in validation errors. Never log beneficiary/account fields; scrub them from `raw_result` jsonb before persist; keep `access_logs.metadata` to `{certificateId, reference}`.

Related: [[bitnob-hmac-signing]], [[backend-nest-rewrite]].
