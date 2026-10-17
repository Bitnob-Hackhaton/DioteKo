# Setup

Detailed local setup. For the short path, see [QUICKSTART.md](QUICKSTART.md). The canonical command list is [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md). The backend variable template is [backend-nest/.env.example](backend-nest/.env.example).

## 1. Ports

| Port | Service | Notes |
|---|---|---|
| 3001 | `backend-nest` | Docker container or host dev server. Never run both |
| 5435 | DioteKo PostgreSQL (host) | `DIOTEKO_PG_HOST_PORT` in root `.env.dev`. `DB_PORT` and `DATABASE_URL` must match it |
| 8090 | Appwrite (dev only) | Console and API. Inside Docker the backend uses `http://appwrite/v1` |
| 3000 | `frontweb` dev server | `vite.config.ts` |

## 2. Environment files

`NODE_ENV` selects the backend env file and database (`backend-nest/src/config/env-files.ts`):

| `NODE_ENV` | File | Database |
|---|---|---|
| unset or `development` | `backend-nest/.env` | `dioteko_dev` |
| `test` | `backend-nest/.env.test` | `dioteko_test` |
| `production` | `backend-nest/.env.prod` | `dioteko_prod` (deploy only) |

Templates (`.env.example`, `.env.test.example`, `.env.prod.example`) are committed. The real `.env*` files are gitignored. Never commit real secrets.

The root `.env.dev` (from `.env.dev.example`) holds only Docker values: PostgreSQL user and password, the host port, Appwrite ports and keys. It is optional, because every compose value has a default.

## 3. backend-nest variables

Names and purpose. Full comments are in `backend-nest/.env.example`.

**Required (the app refuses to boot without them)**

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signs DioteKo access tokens |
| `VC_SIGNING_SECRET` | Signs Verifiable Credentials. A missing value would let anyone forge a valid credential |

**Application**

| Variable | Purpose |
|---|---|
| `PORT` | Default 3001 |
| `APP_BASE_URL` | Public origin of the API. Used for the Bitnob callback. Must be HTTPS when `BITNOB_ENVIRONMENT=production` |
| `CORS_ORIGINS` | Exact origins allowed for the web console. No wildcard. The mobile app is not subject to CORS |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` | Defaults `15m` and `30d` |

**Database**

| Variable | Purpose |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | TypeORM connection. Used by the app and the CLI |
| `DATABASE_URL` | Informational only. The app reads the `DB_*` variables |

**Identity (Appwrite and Google)**

| Variable | Purpose |
|---|---|
| `APPWRITE_ENDPOINT` | `http://localhost:8090/v1` for host tools and the phone. The backend container overrides it to `http://appwrite/v1` |
| `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY` | Filled after the Appwrite first-run setup |
| `APPWRITE_REQUIRE_GOOGLE_IDENTITY` | Requires a Google identity on the Appwrite account. Always `true` in production |
| `APPWRITE_TEST_USER_EMAIL`, `APPWRITE_TEST_USER_PASSWORD` | Used by `npm run seed:appwrite` only |

**Payments (Bitnob)**

| Variable | Purpose |
|---|---|
| `BITNOB_CLIENT_ID`, `BITNOB_CLIENT_SECRET`, `BITNOB_BASE_URL` | Bitnob API credentials and base URL |
| `BITNOB_ENVIRONMENT` | `sandbox` (default) or `production` |
| `BITNOB_WEBHOOK_SECRET` | Verifies webhook signatures. Falls back to the client secret when empty. Empty in development means signatures are not checked; empty in production means every webhook is rejected |
| `BITNOB_INVOICE_RECONCILE_INTERVAL_MS` | Reconciler period. Default 60000. `0` disables it |
| `BITNOB_PAYOUT_BENEFICIARY_ACCOUNT_NUMBER`, `..._ACCOUNT_NAME`, `..._BANK_CODE`, `..._COUNTRY` | Bank beneficiary for certificate payouts. All four are required for a payout |
| `PAYMENT_SIMULATION` | Dev only. Adds a route that marks an invoice paid. Refused unless `NODE_ENV` is `development` or `test` and `BITNOB_ENVIRONMENT=sandbox` |

**Certificates**

| Variable | Purpose |
|---|---|
| `CERT_AUTO_ISSUE` | Lets types without review (birth, marriage, death) skip the agent. Default on when not live, off when `NODE_ENV=production` or `BITNOB_ENVIRONMENT=production`. Only the exact value `true` enables it when live |
| `ADMIN_CERTIFICATES_RESUME_INTERVAL_MS` | Period of the pass that resumes paid requests not yet issued. Default 60000. `0` disables it |
| `VC_ISSUER` | Issuer name written in the credential |
| `CERTIFICATE_VALIDITY_DAYS` | Default 365 |

## 4. Running the backend

| Mode | Command | When to use |
|---|---|---|
| Container | `npm run dev:up` at the repo root | Default. After any change in `backend-nest/src`, run it again: the container has no source mount and keeps the old image |
| Host, hot reload | `cd backend-nest` then `npm run migration:run`, `npm run seed`, `npm run start:dev` | Active development. Stop the container first (both use port 3001) |

Database setup for both databases: `npm run db:setup` at the repo root. `npm run db:reset` is destructive and asks for confirmation.

## 5. Mobile wallet (`frontmobile/`)

```bash
cd frontmobile
npm install
cp .env.exemple .env      # the template file is spelled .env.exemple
npm start                 # then a (Android), i (iOS), or Expo Go with the QR code
```

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Explicit API base URL. On a physical phone, leave it empty so the app uses the LAN IP of the Metro host (`frontmobile/config/config.ts`) |
| `EXPO_PUBLIC_API_PORT` | Default 3001 |
| `EXPO_PUBLIC_APPWRITE_ENDPOINT` | Appwrite URL that the phone can reach. Use an HTTPS tunnel for Google sign-in |
| `EXPO_PUBLIC_APPWRITE_PROJECT_ID` | Appwrite project ID |

`EXPO_PUBLIC_*` values are bundled into the app. Never put a secret in them. `localhost` on a phone refers to the phone itself.

## 6. Organisation console (`frontweb/`)

```bash
cd frontweb
npm ci                  # .npmrc sets legacy-peer-deps=true
cp .env.example .env
npm run dev             # http://localhost:3000
```

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Default `http://localhost:3001/api` |
| `VITE_USE_MOCKS` | `true` for simulated data without the API. Default `false` |
| `VITE_ENV` | `sandbox` or `production`, shown in the environment banner |

`VITE_*` values are fixed at build time. Rebuild after changing them.

## 7. Tests and checks

| Package | Command | Scope |
|---|---|---|
| `backend-nest` | `npm test` | Jest unit tests, no database |
| `backend-nest` | `npm run test:e2e` | E2E against `dioteko_test`. See [docs/TESTING.md](docs/TESTING.md) |
| `backend-nest` | `npm run typecheck`, `npm run build` | Type check and compile |
| `frontmobile` | `npm run lint` | The only automated check. No mobile test suite exists |
| `frontweb` | `npm test`, `npm run lint` | Vitest and ESLint, Prettier |

## 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Backend refuses to start | `JWT_SECRET` or `VC_SIGNING_SECRET` is empty, or an env value is invalid (see `env.validation.ts`) |
| `404` on `/api/admin-certificates/...` from the app | Stale container image. Run `npm run dev:up` again |
| `403 IP address not whitelisted` from Bitnob | Allow your public IP in the Bitnob dashboard. Use the narrowest range (`/32`) |
| Invoice stays `pending` in sandbox | Expected: sandbox invoices cannot be paid through the API. Use `PAYMENT_SIMULATION` in dev, or see [docs/BITNOB_PASSER_EN_LIVE.md](docs/BITNOB_PASSER_EN_LIVE.md) |
| Google sign-in fails with `redirect_uri_mismatch` | The redirect URI registered in Google Cloud does not match the Appwrite callback. See "Appwrite first-run" in [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md) |
| Phone shows "backend unreachable" | Leave `EXPO_PUBLIC_API_BASE_URL` empty, check that the phone and the PC share the same network, and check that the firewall allows port 3001 |
| `migration:generate` keeps producing changes | Known loop on the partial indexes of `bitnob_payouts` and `bitnob_withdrawals`. Not a real change. See [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md) |

Warning: never change `_APP_OPENSSL_KEY_V1` after the first Appwrite boot. Existing data becomes unreadable.

Demo accounts come from `npm run seed` (dev and test only, the seed refuses `NODE_ENV=production`). Their logins are listed in [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md).
