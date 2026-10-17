# backend-nest

NestJS 11 + TypeORM 0.3 + PostgreSQL API for DioteKo. It is the only backend in use. `frontmobile/` and `frontweb/` both call it.

- Port **3001**, global prefix **`/api`**
- Health probe: `GET /api/healthz` (public, runs `SELECT 1`). `GET /api/health` is a stub for a future domain, not a health check
- Swagger UI: http://localhost:3001/api-docs (outside the prefix)
- Docker image: `node:20-alpine` (`Dockerfile`)

Architecture and flows: [../ARCHITECTURE.md](../ARCHITECTURE.md) and [../docs/ARCHITECTURE_AS_BUILT.md](../docs/ARCHITECTURE_AS_BUILT.md).

## Modules (`src/modules/`)

| Module | Routes (under `/api`) | State |
|---|---|---|
| `healthz` | `GET /healthz` | Real |
| `identity` | `POST /auth/appwrite/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/login`, `GET /auth/me`, `GET /users/me` | Real. Appwrite Google login; email and password for staff accounts |
| `did-vc` | `/did-vc/dids`, `/did-vc/credentials`, `/did-vc/presentations` | Real |
| `admin-certificates` | `/admin-certificates/*` | Real. The only complete domain |
| `bitnob` | `/bitnob/webhooks` (public, signed), `/bitnob/*` | Real in sandbox |
| `lightning` | None (no HTTP route) | Invoice and payment registry (`LightningInvoicesService`) |
| `consent` | `/audit/consents`, `/audit/access-logs` | Real, minimal |
| `health`, `kyc`, `education`, `transport`, `employment`, `social-aid`, `merchant` | `GET /{domain}` | Stubs returning `{ "implemented": false }` |

Certificate routes (`/admin-certificates`): types, requests (create, list, stats, detail, resubmit), invoices (create, read, status), organisation review (`/organization/requests/*`: list, detail, accept, reject, request-info), issue, signed file link, PDF download, verify, Bitnob payouts. The dev-only `dev/requests/:id/mark-paid` answers 404 unless `PAYMENT_SIMULATION=true`.

## Setup

Full steps: [../docs/DEV_WORKFLOW.md](../docs/DEV_WORKFLOW.md). Short version:

```bash
# repo root
npm run dev:up                 # PostgreSQL, this app as a container, Appwrite

# backend-nest
npm install
cp .env.example .env           # set JWT_SECRET and VC_SIGNING_SECRET

# repo root
npm run db:setup               # migrations and seed, dioteko_dev and dioteko_test
curl http://localhost:3001/api/healthz
```

Host mode with hot reload (do not run it together with the container, both use port 3001):

```bash
npm run migration:run
npm run seed
npm run start:dev
```

**Required variables:** `JWT_SECRET` and `VC_SIGNING_SECRET`. The app refuses to boot if either is empty (`src/config/env.validation.ts`).

**Environment files:** `NODE_ENV` picks the file (`src/config/env-files.ts`): `.env` (development, `dioteko_dev`), `.env.test` (test, `dioteko_test`), `.env.prod` (production, `dioteko_prod`). Templates: `.env.example`, `.env.test.example`, `.env.prod.example`. Real `.env*` files are gitignored.

The full variable list, with comments, is in [.env.example](.env.example). See also [../SETUP.md](../SETUP.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run start:dev` | Run with watch mode (host mode) |
| `npm run build` | Compile with Nest CLI |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest unit tests, no database |
| `npm run test:e2e` | E2E tests against `dioteko_test`. See [../docs/TESTING.md](../docs/TESTING.md) |
| `npm run migration:run`, `npm run migration:revert` | Apply or roll back migrations |
| `npm run migration:generate -- src/database/migrations/<Name>` | Generate a migration from entity changes |
| `npm run seed` | Idempotent baseline: roles, one demo organisation, demo accounts. Refuses `NODE_ENV=production` |
| `npm run seed:appwrite` | Creates the Appwrite E2E test user |
| `npm run smoke:bitnob` | Offline HMAC check and a read-only sandbox probe |
| `npm run start:prod` | `node dist/main.js` (after `build`) |

## Known simplifications

Read these before relying on the backend in a demo or a deployment. Full list: [../docs/KNOWN_ISSUES.md](../docs/KNOWN_ISSUES.md).

- **Bitcoin anchoring is simulated.** `certificate-anchor.service.ts` returns a random transaction ID. No transaction is broadcast.
- **VCs use a shared HS256 secret** (`VC_SIGNING_SECRET`). Only this backend can verify them. DIDs have the form `did:dioteko:<uuid>` and cannot be resolved.
- **Cross-tenant revoke is not enforced.** Any issuer or admin can revoke another organisation's credential (`TODO` in `src/modules/did-vc/controllers/credentials.controller.ts`).
- **Certificate PDFs are stored on the container filesystem.** No volume is mounted.
- **Issuance and revocation of VCs are not written to `access_logs`.** Verification and money movements are logged.
- **A sandbox invoice cannot be paid through the API.** `PAYMENT_SIMULATION=true` (dev only) lets a holder mark their own invoice as paid. Certificates obtained this way carry `simulatedPayment=true`.
- **Review skip** (`CERT_AUTO_ISSUE`): birth, marriage and death are accepted without an agent check, so the data is only declared by the holder. Such a certificate carries `declaredNotVerified: true`.
- **Bitnob contract:** the sandbox behaviour was checked against the live API. Payment-side details are in [../docs/BITNOB.md](../docs/BITNOB.md).

## Pay-in rail

Bitnob Lightning is the only pay-in. The `lightning` module is the invoice and payment registry. An invoice whose provider is not Bitnob is refused (`PROVIDER_MISMATCH`).

## Tests

- `npm test` runs the Jest unit suite without a database.
- `npm run test:e2e` runs against `dioteko_test`. It uses `NODE_ENV=test` and a separate env file. Check [../docs/TESTING.md](../docs/TESTING.md) first.
