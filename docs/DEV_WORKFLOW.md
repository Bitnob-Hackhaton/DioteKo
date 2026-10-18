# Dev Workflow — DioteKo

Day-to-day commands for this repo. New developer? Do **Quick start** top to bottom.

- `backend-nest/` — the NestJS + TypeORM + PostgreSQL backend (port 3003). The only backend the apps call.
- `frontmobile/` — Expo / React Native citizen app. Calls `backend-nest` only.
- `frontweb/` — staff web console (TanStack Start). Dev server on port 3000.
- Appwrite — self-hosted identity provider for the mobile Google-OAuth login (port 9000, dev only).

---

## Quick start (backend-nest)

```bash
# 1. DioteKo's own Postgres + the backend-nest container + Appwrite
npm run dev:up                       # from the REPO ROOT

# 2. app config
cd backend-nest
npm install
cp .env.example .env                 # fill JWT_SECRET / VC_SIGNING_SECRET — app won't boot without them
cd ..

# 3. create + migrate + seed the databases (dioteko_dev_bitnob AND dioteko_test_bitnob)
npm run db:setup

# 4. check it's alive
curl http://localhost:3003/api/healthz          # {"status":"ok","db":"up",...}
```

Swagger: <http://localhost:3003/api-docs>. Appwrite console: <http://localhost:9000>.

**Host mode** (hot reload — don't run at the same time as the container, they share port 3003):

```bash
cd backend-nest
npm run migration:run && npm run seed
npm run start:dev
```

---

## Environments — `.env` / `.env.test` / `.env.prod`

One DioteKo Postgres instance (container `dioteko-postgres-bitnob`, host port **5442**, same user / password), **three databases**. `NODE_ENV`
picks the env file — one resolver, `backend-nest/src/config/env-files.ts`, used by the app, the
TypeORM CLI and the seed:

| `NODE_ENV` | env file | database | used for |
|---|---|---|---|
| unset / `development` | `backend-nest/.env` | `dioteko_dev_bitnob` | day-to-day dev |
| `test` | `backend-nest/.env.test` | `dioteko_test_bitnob` | `npm run test:e2e` |
| `production` | `backend-nest/.env.prod` | `dioteko_prod` | deploy only (not created locally) |

Templates are committed (`.env.example`, `.env.test.example`, `.env.prod.example`); the real
`.env*` files are gitignored. `.env.test.example` ships working test-only secrets, so
`npm run test:e2e` works right after `cp .env.test.example .env.test`.

> **Own Postgres.** DioteKo runs its own `dioteko-postgres-bitnob` on its own network and port, with no init service
> (see "Infra reference" below).

---

## backend-nest commands (`cd backend-nest`)

| Command | What |
|---|---|
| `npm run start:dev` | `nest start --watch` (host mode) |
| `npm run build` / `npm run typecheck` | compile / `tsc --noEmit` |
| `npm test` | Jest unit suite, no database (run it for the current count) |
| `npm run test:e2e` | Jest E2E vs `dioteko_test_bitnob` (see `docs/TESTING.md`) |
| `npm run migration:run` / `:revert` | apply / roll back migrations (dev DB; `cross-env NODE_ENV=test` for the test DB) |
| `npm run migration:generate -- src/database/migrations/<Name>` | new migration from entity changes |
| `npm run seed` | idempotent baseline: 4 roles, 1 demo org + issuer DID, 3 demo users |
| `npm run seed:appwrite` | ensure the Appwrite E2E test user (no-op until Appwrite is configured) |
| `npm run smoke:bitnob` | offline HMAC self-check + live read-only sandbox probe |

**Demo logins** (from `npm run seed`, password `demo-password-change-me` for all):

| Email | Role |
|---|---|
| `issuer-demo@dioteko.local` | issuer |
| `admin-demo@dioteko.local` | admin |
| `holder-demo@dioteko.local` | holder |

```bash
curl -X POST http://localhost:3003/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"issuer-demo@dioteko.local","password":"demo-password-change-me"}'
```

> `npm run migration:generate` to "check for drift" can loop forever re-creating the
> `bitnob_payouts` / `bitnob_withdrawals` partial indexes (Postgres normalises the `WHERE`
> predicate). Not a real schema change — see the migration file headers.

---

## Root commands (`npm run ...` at the repo root)

| Command | Effect |
|---|---|
| `dev:up` | start DioteKo's Postgres, wait until it is healthy, create `dioteko_dev_bitnob`/`dioteko_test_bitnob` if missing, build & start `backend-nest` + Appwrite |
| `dev:down` | stop DioteKo's containers (data is kept in the `postgres_data` volume) |
| `dev:down:clean` | same + delete the **Postgres and Appwrite** volumes (destructive) |
| `dev:logs` / `dev:ps` | `docker compose logs -f` / list containers |
| `db:setup` | `migration:run` + `seed` for **both** `dioteko_dev_bitnob` and `dioteko_test_bitnob`, then best-effort `seed:appwrite` |
| `db:reset` | **DESTRUCTIVE**: drop + recreate `dioteko_dev_bitnob` and `dioteko_test_bitnob`, re-migrate + re-seed. Prompts unless `-- --yes`. Nothing outside DioteKo's own Postgres is touched. |

Bare `docker compose up` at the root fails by design (`DEV_UP_GUARD`) — use `npm run dev:up`.
It passes `--env-file .env.dev` to compose (copy `.env.dev.example`; every value also has a
built-in default so a fresh clone works without it).

### Image `backend-nest` périmée (à lire après tout changement de routes)

Le conteneur `backend-nest` n'a ni volume de code ni `watch` : il exécute l'image construite au dernier `dev:up`.
Un `docker compose restart` ne suffit pas.

- Après tout changement de route ou de code dans `backend-nest/src/`, lancer `npm run dev:up` (reconstruit l'image).
- Symptôme d'image périmée : le mobile reçoit `Cannot GET /api/admin-certificates/requests` (404) alors que la route
  existe dans le source.
- Vérification : `curl -si http://localhost:3003/api/admin-certificates/requests` doit répondre **401** (route présente,
  protégée par JWT). Un **404** signifie que l'image ne contient pas la route.
- Mode hôte (`npm run start:dev`) : pas concerné, il recompile à chaud. Ne pas lancer les deux en même temps (port 3003).

---

## Automatic certificate issuance (`CERT_AUTO_ISSUE`)

- `CERT_AUTO_ISSUE` (optional, `backend-nest/.env`). Default: `true` when not live, `false` when live, i.e. `NODE_ENV=production` **or** `BITNOB_ENVIRONMENT=production` (`resolveAutoIssue` in `configuration.ts`, `certificates.autoIssue`). When live, only the exact value `true` enables it.
- `true`: types that need no review (birth, marriage, death) are issued as soon as the invoice is paid. `false`: they also go through an agent (`pending`).
- A certificate issued without review carries `declaredNotVerified: true` in the VC and a line in the PDF.
- Invalid values are refused at boot (`env.validation.ts`).

## Bitnob Lightning pay-in (dev)

Certificate requests are paid with a Lightning invoice created at Bitnob, the only pay-in rail. Setup, in order:

1. Fill `BITNOB_CLIENT_ID`, `BITNOB_CLIENT_SECRET` and `BITNOB_ENVIRONMENT=sandbox` in `backend-nest/.env`.
   - Optional: `BITNOB_INVOICE_RECONCILE_INTERVAL_MS` (default `60000` ms = 1 min; range 5 000–86 400 000 ms; `0` = disabled). Tune if the reconciler loop's interval needs adjustment for your environment.
2. In the Bitnob dashboard, **allow the IP your machine reaches the internet from** (every call answers 403 "IP address
   not whitelisted" otherwise, sandbox included). Use the narrowest range that works (`/32`), not a `/8`.
3. Without a webhook nothing else is needed: the status route (`GET /api/admin-certificates/requests/:id/lightning-invoices/status`)
   and `issue` read the invoice from Bitnob themselves. The background reconciler (`BitnobInvoiceReconcilerService`) polls pending invoices every interval and settles them if the status changed.
4. For webhooks, expose port 3003 over HTTPS (a tunnel such as ngrok) and register `https://<tunnel>/api/bitnob/webhooks` in the
   Bitnob dashboard, then set `BITNOB_WEBHOOK_SECRET` (it falls back to the client secret when empty). Bitnob delivers from
   18.171.51.218 and 13.134.154.133 (subject to change). A webhook is only a signal: the invoice is still read from Bitnob before being marked paid.
5. A sandbox invoice cannot be paid through the API (sending Lightning is disabled). Paying one needs a real Lightning
   wallet, and the invoices carry the mainnet prefix `lnbc`: confirm with Bitnob what a payment settles on before paying one.

Details and the verified API contract: `docs/BITNOB.md` ("Lightning pay-in"). Known gaps: `docs/KNOWN_ISSUES.md`.

## KYC — Idswyft (self-hosted, dev only)

Identity verification (`docs/KYC.md`) calls a self-hosted Idswyft. It is defined **in this repository**, like Appwrite:
`docker-compose.idswyft.yml`, included by `docker-compose.dev.yml`, so `npm run dev:up` starts it (own PostgreSQL, ML engine, API,
dashboard; nothing outside the repo). Images are built from the open-source repository, pinned to the tag `IDSWYFT_VERSION`
(first build: a few minutes). A one-shot service `idswyft-migrations` copies the release's SQL migrations into a volume, because the API image does not contain them. Disable it by commenting the
`docker-compose.idswyft.yml` line in `docker-compose.dev.yml`; stop only Idswyft with
`docker compose -p dioteko-dev-bitnob stop idswyft-api idswyft-dashboard idswyft-ml-engine idswyft-postgres`.

1. `npm run dev:up` from the repo root. Ports 8000 (API) and 8087 (dashboard) must be free: stop any other Idswyft stack first
   (e.g. an older copy started from outside the repo). Change the ports with `IDSWYFT_API_HOST_PORT` / `IDSWYFT_DASHBOARD_HOST_PORT` in `.env.dev`.
2. Dashboard: `http://localhost:8087`. Log in with the one-time code printed in the API container logs
   (`docker logs dioteko-idswyft-api-bitnob`). Do not paste that code or any credential into a file.
3. API: `http://localhost:8010`. Interactive docs: `http://localhost:8010/api/docs`. Health: `/api/health`.
4. Create the API key with `npm run kyc:bootstrap` (repo root). It signs in (or registers) the dev developer `kyc-dev@dioteko.dev` through the OTP flow — this dev instance has no e-mail provider, so the API
   returns the one-time code itself — and mints a key; the key is written to `backend-nest/.env` as `IDSWYFT_API_KEY` and never printed.
   `--email <e-mail>` uses another developer; or create the key in the dashboard. `--force` replaces a non-empty `IDSWYFT_API_KEY`. Then `npm run dev:up` so the
   backend container picks up the new `.env`. A development Idswyft issues *sandbox* keys. Never commit the key.
5. Set the variables (`backend-nest/.env`, see the table in `docs/KYC.md` §8; infra values such as ports and Idswyft's own DB are in `.env.dev`):

   | Variable | Dev value |
   |---|---|
   | `IDSWYFT_BASE_URL` | `http://localhost:8010` in host mode (`npm run start:dev`). The backend container ignores it: `docker-compose.dev.yml` sets `http://idswyft-api:3001` (service name over the compose network) |
   | `IDSWYFT_API_KEY` | written by `npm run kyc:bootstrap` |
   | `IDSWYFT_WEBHOOK_SECRET` | optional in dev (a webhook without it is stored, never acted on) |
   | `IDSWYFT_ENGINE_URL` | ML engine for the pre-upload photo check; the backend container gets `http://idswyft-ml-engine:3002` from `docker-compose.dev.yml`; empty = no check |
   | `KYC_ENFORCEMENT` | `on` (default). Use `off` to file residence and identity requests without Idswyft running |
   | `KYC_ENFORCED_TYPES` | empty; `birth,marriage,death` makes the planned types blocking |
   | `KYC_MAX_SESSIONS_PER_DAY` | `5` |
   | `KYC_MRZ_PRECHECK` | `strict` (default). `warn` / `off`: an unreadable MRZ no longer blocks the photo (ignored in production) |
   | `KYC_FALLBACK_MANUAL_REVIEW` | `off` (default). `on`: a failed automatic check sends the dossier to an agent (console, "Vérifications d'identité") |
   | `KYC_PROVIDER_MODE` | `idswyft` (default). `manual_only`: Idswyft is not called, an agent decides everything (dev only, ignored in production) |
   | `KYC_DOC_ENCRYPTION_KEY` | 64 hex chars (`openssl rand -hex 32`); required for the two flags above to keep photos for the agent |
   | `KYC_DOC_RETENTION_DAYS` | `30` |

   After changing `backend-nest/.env`, run `npm run dev:up` again: the container reads the file at (re)creation.
6. **Migration:** dev DB: `cd backend-nest && npm run migration:run`. Test DB: `cross-env NODE_ENV=test npm run migration:run`
   (same convention as the commands table above). Rollback: `npm run migration:revert`.
   Migration `1789000000000-CreateKycVerifications` creates `kyc_verifications` and `kyc_webhook_events`;
   `1789100000000-AddManualReviewToKyc` adds the review columns and `kyc_documents` (reversible).
7. **Container:** after a backend code change, run `npm run dev:up` (rebuilds the image; see "Image `backend-nest` périmée").
8. `KYC_ENFORCEMENT=off` is for local dev only. It is ignored when `NODE_ENV=production`, and the boot logs a warning.

**Webhook limitation (local):** Idswyft refuses to register a webhook URL that points to `localhost` or a private address
(SSRF check). Locally, no webhook arrives: the dossier advances only when the status is re-read (`GET /api/kyc/status`,
which the KYC screen polls about every 4 s while the dossier is open). To test the webhook itself, expose port 3003 over HTTPS
(a tunnel, as for Bitnob) and register `https://<tunnel>/api/kyc/webhook/idswyft` in Idswyft by hand. No DioteKo code calls the
registration endpoint.

**E2E note:** `.env.test` must not set `KYC_ENFORCEMENT=off`: `test/kyc.e2e-spec.ts` expects a residence request without KYC to answer `403 KYC_REQUIRED`. The E2E never reaches Idswyft.

---

## Appwrite (self-hosted, dev only)

`npm run dev:up` starts `appwrite` + `appwrite-mariadb` + `appwrite-redis` (≈1 GB of images +
volumes, always running). Stop just Appwrite:

```bash
docker compose -p dioteko-dev-bitnob stop appwrite appwrite-mariadb appwrite-redis
```

Disable it entirely: comment the `include: - docker-compose.appwrite.yml` line in
`docker-compose.dev.yml`.

### Appwrite first-run (one-time, needs the console)

Appwrite has no headless project setup. After the first `npm run dev:up`:

1. Open <http://localhost:9000> → create the root/admin account.
2. Create a project named `dioteko`. Copy its **Project ID** → `APPWRITE_PROJECT_ID` in
   `backend-nest/.env` (and `.env.test` if you want the Appwrite E2E).
3. **Overview → Integrations → API Keys** → create a key with scopes `users.read` + `users.write`.
   Copy it → `APPWRITE_API_KEY`.
4. **Auth → Settings** → enable the **Google** OAuth2 provider (client id/secret from your
   Google Cloud OAuth credentials; authorized redirect URI as shown in the Appwrite UI).
5. Set `APPWRITE_REQUIRE_GOOGLE_IDENTITY` in `backend-nest/.env`:
   - Leave **unset or `true`** (default) if you want to test real Google OAuth flows (strict mode, production-like).
   - Set to **`false`** only if you want to seed a test user without Google identity and skip real OAuth in E2E tests.
6. `npm run seed:appwrite` → creates the `appwrite-e2e@dioteko.local` test user with **email verified = true**
   (so it passes the login flow's verification check).

The backend-nest container talks to Appwrite in-network (`APPWRITE_ENDPOINT=http://appwrite/v1`,
set in `docker-compose.dev.yml`); host tools and the mobile app use `http://localhost:9000/v1`.

> `_APP_OPENSSL_KEY_V1` in `.env.dev` encrypts Appwrite data at rest — **never change it** after
> the first boot or existing data becomes unreadable.

### Testing Google login from a phone or emulator

Real Appwrite/Google OAuth needs a physical device or emulator. Expo Go reaches the browser step (the app passes an `exp://…` success URL, which Appwrite
accepts), but the final target is a dev build (`dioteko://auth/google/callback`).

**Prerequisites:**
- Dev build (run `eas build --platform android/ios --profile preview` or `expo prebuild` + Xcode/Android Studio) for the real flow.
- Platform registered in Appwrite console: `com.dioteko.app` (Android) and `com.dioteko.app` (iOS) — the app sends this platform id.
- Google provider enabled in Appwrite console (step 4 above).
- Google Cloud Console: an OAuth 2.0 **Web application** client whose only authorized redirect URI is **Appwrite's callback** (see below).

**Two different redirect URLs — do not mix them up:**
| URL | Who receives it | Where it is configured |
|---|---|---|
| Appwrite callback `https://<appwrite-host>/v1/account/sessions/oauth2/callback/google/<PROJECT_ID>` | Google redirects the browser here after sign-in | **Google Cloud** → authorized redirect URIs (and shown in the Appwrite Google provider settings) |
| App deep link `exp://192.168.x.x:8081/--/auth/google/callback` or `dioteko://auth/google/callback` | Appwrite redirects here after it has the Google result (`success`/`failure`) | Nowhere in Google. It is sent by the app on each login; Appwrite validates it |

Adding `exp://…` to Google fails ("must end with a public top-level domain") and is not needed.

**Why a plain local setup fails (measured against the local Appwrite 1.5.4):** Appwrite builds the callback from the request's host name and **drops the
port**. The same login request produced `redirect_uri=http://localhost/v1/…` (from `localhost:8090`), `http://192.168.1.69/v1/…` (from your LAN IP — rejected by Google,
which does not accept IP addresses) and `https://<tunnel-host>/v1/…` (from an HTTPS tunnel — valid). Also, a phone's `localhost` is the phone itself, so
`EXPO_PUBLIC_APPWRITE_ENDPOINT=http://localhost:9000/v1` cannot work on a physical device. Use an HTTPS tunnel:

**HTTPS tunnel (recommended; works for Android and iOS):**
- `npm run tunnel` (repo root) asks which tunnels to open and starts them as **Docker containers** (`dioteko-ngrok-appwrite-bitnob`, `dioteko-ngrok-backend-bitnob`, compose profile `tunnel`, never started by `dev:up`; the stack must be up first). `npm run tunnel:appwrite` / `tunnel:backend` skip the questions; `npm run tunnel:logs` follows their logs (also visible in Docker Desktop), `tunnel:ps` lists them, the ngrok inspector shows live requests at <http://localhost:4041> (Appwrite) and <http://localhost:4042> (backend), `tunnel:down` removes them (`dev:down` removes them too). Each reads its own `NGROK_<APPWRITE|BACKEND>_AUTHTOKEN` and `_DOMAIN` from `.env.dev`; the script prints the values to set below (Appwrite) or the Bitnob webhook URL (backend). A free ngrok account gets one static domain and one agent session, so give each tunnel its **own** ngrok account.
- Google Cloud → OAuth client → **Authorized redirect URIs**: `https://xxxxx.ngrok-free.app/v1/account/sessions/oauth2/callback/google/<PROJECT_ID>` (remove any `exp://` entry).
- `frontmobile/.env`: `EXPO_PUBLIC_APPWRITE_ENDPOINT=https://xxxxx.ngrok-free.app/v1`, then restart with `npx expo start --clear` (the `EXPO_PUBLIC_*` values are inlined at bundle time).
- The free ngrok tier can show a "Visit Site" warning page to browsers; confirm it once, or use a Cloudflare tunnel.
- The backend is not affected: it verifies the Appwrite JWT in-network (`http://appwrite/v1`).


**Android USB without a tunnel (untested):** the callback would be `http://localhost/v1/…` (port 80), so it would need `adb reverse tcp:80 tcp:8090` and `http://localhost` in
the app endpoint; port 80 is already used on this machine by another service, and this path has not been tried.

**Setup steps:**
1. Copy `frontmobile/.env.exemple` (sic) → `frontmobile/.env`.
   - Set `EXPO_PUBLIC_APPWRITE_ENDPOINT` (tunnel or localhost).
   - Set `EXPO_PUBLIC_APPWRITE_PROJECT_ID` (from Appwrite console).
   - `EXPO_PUBLIC_API_BASE_URL`: leave empty on a physical phone (auto: Expo host LAN IP, see `frontmobile/config/config.ts`) or set `http://<LAN-IP>:3003/api`. `localhost` only works for an iOS simulator / web (on a phone it is the phone itself). The auto IP is the Metro host (`Metro: exp://<IP>:8083`), so it follows Wi-Fi changes; `expo-network` is not needed (it returns the phone IP, not the PC IP).
   - **Never put API keys in `EXPO_PUBLIC_*` vars.**
2. Rebuild the app: `cd frontmobile && eas build --platform android/ios --profile preview` (or use Xcode/Android Studio locally).
3. Install on device.
4. Ensure backend-nest container is running: `npm run dev:up` from repo root.
5. Migrate and seed: `npm run db:setup` and `npm run seed:appwrite`.
6. Tap "Google" button in app → browser opens, user authenticates with Google → redirects back to app.
7. On success, app stores token and shows logged-in screen.

**Common issues:**
- **"redirect_uri_mismatch" from Google:** The redirect URI in Google Cloud Console doesn't match what Appwrite is requesting. Check:
  - Appwrite console Google provider settings → copy exact callback URI shown.
  - Google Cloud Console → OAuth 2.0 credentials → authorized redirect URIs → add the callback URI exactly.
- **Browser opens then the app logs `Connexion Google annulee` (`type: "cancel"`):** the page could not load (typically `EXPO_PUBLIC_APPWRITE_ENDPOINT` is `http://localhost:8090/v1` on a physical phone) or was closed before the redirect. Use the tunnel endpoint and restart Expo with `--clear`.
- **Appwrite not reachable (timeout):** the HTTPS tunnel may be down, or its URL changed. Re-run the tunnel and update Google + `frontmobile/.env`.
- **App not receiving callback:** the redirect is `Linking.createURL('auth/google/callback')`: `dioteko://auth/google/callback` in a dev/standalone build
  (`"scheme": "dioteko"` in `frontmobile/app.json`), `exp://<ip>:<port>/--/auth/google/callback` in Expo Go. Appwrite accepts both (measured).

### Production hardening checklist

Before deploying to production:

1. **Disable non-Google auth methods in Appwrite console:**
   - **Auth → Settings:** Disable "Email/Password", "Anonymous", "Magic URL", "Email OTP", "Phone OTP" (unless needed).
   - Keep **Google OAuth** enabled.

2. **Set `APPWRITE_REQUIRE_GOOGLE_IDENTITY=true`** in backend production env:
   - Rejects any Appwrite account that has no Google identity (401). It is forced to `true` in production regardless of the value set.
   - Independently of this flag, every login already requires `emailVerification=true` and an enabled Appwrite account (403 otherwise).
   - Disabling the other auth methods (step 1) is what actually closes the "pre-registered email" hole; the flag is the backend's safety net.

3. **Use least-privilege Appwrite API key:**
   - Instead of the dev key (which may have all scopes), create a production key with **only** `users.read` scope.
   - Use it for runtime operations if any are added (currently not needed).
   - Keep the dev key separate for migrations and admin tasks.

4. **Update mobile env vars to production endpoints:**
   - `EXPO_PUBLIC_APPWRITE_ENDPOINT` → production Appwrite HTTPS URL.
   - `EXPO_PUBLIC_API_BASE_URL` → production backend URL.
   - Rebuild and deploy the app.

5. **TLS/HTTPS everywhere:**
   - Appwrite: configure TLS certificate (not self-signed).
   - Backend: serve HTTPS (e.g., via reverse proxy). The mobile app does not enforce HTTPS itself; use `https://` values in `EXPO_PUBLIC_*`.

6. **Monitor and audit:**
   - Log all login attempts (backend logs include `[CALL]` and `[RESULT]` tags).
   - Review Appwrite console for suspicious activity or disabled accounts.
7. **KYC (Idswyft), before real identity data:**
   - Set `IDSWYFT_BASE_URL` (HTTPS), `IDSWYFT_API_KEY` and `IDSWYFT_WEBHOOK_SECRET`. In production a missing webhook secret answers 401 and a missing key answers 503.
   - Keep `KYC_ENFORCEMENT` on (`off` is ignored in production).
   - Get the CDP authorisation and confirm Idswyft's data region first (`docs/KYC.md` §11).

---

## Mobile (`frontmobile/`)

```bash
cd frontmobile
npm install
npm start          # expo start   (npm run android | ios | web)
npm run lint       # the only automated check for this package
```

---

## Web console (`frontweb/`)

Organisation staff console (TanStack Start + Node server). Node 22+, npm.

```bash
cd frontweb
npm ci                      # .npmrc sets legacy-peer-deps (npm 10 crashes on the vitest/vite peer graph)
cp .env.example .env        # VITE_API_BASE_URL, VITE_USE_MOCKS, VITE_ENV
npm run dev                 # http://localhost:3000 (VITE_USE_MOCKS=true to work without the API)
npm test                    # vitest
npm run lint                # eslint + prettier
npm run build && npm start  # production build, node .output/server/index.mjs (PORT, HOST)
docker build -t dioteko-console .
```

`VITE_*` variables are baked in at build time. The console origin must be listed in the backend `CORS_ORIGINS`
(`backend-nest/.env`, comma-separated exact origins, no wildcard). Default: `http://localhost:3000` outside production,
none in production. The mobile app is not subject to CORS.

---

## Infra reference

### DioteKo's Postgres

Service `postgres` of `docker-compose.dev.yml`, container `dioteko-postgres-bitnob`, image `postgres:18-alpine`, on the
`dioteko-dev-bitnob` project's own default network (shared with `backend-nest` and Appwrite only). Data lives in the named
volume `postgres_data`. Dev-only credentials `postgres_user` / `postgres_password`. Databases: `dioteko_dev_bitnob`
(created by `POSTGRES_DB` on first boot) and `dioteko_test_bitnob` (created by `npm run dev:up` / `db:setup`, no init
service). Nothing depends on a Postgres container or Docker network from another project, so the repo runs on any
machine with Docker.

The host port is published for tools on your machine (migrations, `psql`, GUI clients) and is set by
`DIOTEKO_PG_HOST_PORT` in the root `.env.dev` (default **5442**, chosen to avoid the 5432/5433/5434 that other
projects commonly use). If you change it, set the same value as `DB_PORT` and in `DATABASE_URL` in
`backend-nest/.env` and `.env.test`. Inside Docker, `backend-nest` always uses `postgres:5432`.

### Ports

| Port | Service |
|---|---|
| 3000 | `frontweb/` console (`npm run dev`, or the production container) |
| 3003 | `backend-nest` (container or `npm run start:dev`), API under `/api`, Swagger at `/api-docs` |
| 5442 | DioteKo Postgres (`DIOTEKO_PG_HOST_PORT`) |
| 8010 | Idswyft API (KYC, separate stack, dev only; see the KYC section above) |
| 8087 | Idswyft dashboard (KYC, separate stack, dev only) |
| 9000 | Appwrite console/API (dev) |

The mobile app reaches `backend-nest` on port 3003 (`frontmobile/config/config.ts`).

Appwrite's MariaDB and Redis are internal to the compose network (not published).
