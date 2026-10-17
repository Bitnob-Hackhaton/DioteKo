---
name: backend-nest-migration
description: backend-nest/ (NestJS + TypeORM + Postgres) is the running backend (port 3001, prefix /api), delivered in numbered Increments; Bitnob fiat payouts live here
metadata:
  type: project
---

`backend-nest/` is the running backend (port 3001, prefix `/api`).

**Why:** the architecture is a modular NestJS backend with DID + Verifiable
Credentials and Bitnob as the payment rail (see CLAUDE.md §0).

**How to apply:**
- Work is shipped as "Increment N" branches/commits. Increment 3 is the Bitnob payout
  3-step rework (quote -> initialize -> finalize). Increment 4 is Bitnob on-chain
  withdrawals + bulk-transfers (`bitnob_withdrawals` / `bitnob_bulk_batches` /
  `bitnob_bulk_batch_items`); its review verdict was FIX-THEN-SHIP (retry-items race,
  withdrawal lost-response unreconcilable, thin withdrawal raw_result).
- Increment 7 covers env separation `.env`/`.env.test`/`.env.prod` via `config/env-files.ts` +
  `config/load-env.ts`, the E2E harness under `backend-nest/test/`, ops health
  `GET /api/healthz` in `src/modules/healthz/`, and `docker-compose.appwrite.yml`.
  Its review verdict was FIX-THEN-SHIP. Fix items (verify in code whether still open):
  (1) `healthz.controller.ts` `catch {}` swallows the DB error — no `[RESULT]` log on 503 + the
  `{status,db,uptimeSeconds}` payload never reaches the client (global
  `HttpExceptionFilter` rebuilds the body); (2) `docker-compose.prod.yml` `backend-nest`
  service has NO `env_file:` and omits `APP_BASE_URL` (`@IsNotEmpty()` → boot throws) +
  `BITNOB_ENVIRONMENT`/`BITNOB_WEBHOOK_SECRET`; its comments reference an `env_file` that
  isn't there. Prod is not deployed so non-urgent. M1/M2/A1 were confirmed met.
- Money-movement code (Bitnob payouts) is in `backend-nest/src/modules/bitnob/` and
  `backend-nest/src/modules/admin-certificates/`. Treat it as high-stakes (CLAUDE.md §11):
  demand tests, audit logging, PII scrubbing, no irreversible action without a gate.
- Global `ValidationPipe` uses `whitelist + forbidNonWhitelisted + transform`.
  Global guards: `JwtAuthGuard` then `RolesGuard` (`@Roles` via `getAllAndOverride([handler, class])`).
- Bitnob payout `finalize` (real disbursement) is HARD-DISABLED when
  `BITNOB_ENVIRONMENT=production` as an interim safety measure — check this still holds.
- See [[review-gate-convention]].
