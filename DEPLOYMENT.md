# Deployment

**Status:** no production deployment is documented or verified in this repo. This file lists what exists, what the code already enforces in production, and what must be done before a first deployment.

Do not use `docker-compose.prod.yml` as a production recipe yet (see section 1).

## 1. What exists

| Item | Location | State |
|---|---|---|
| Backend image | `backend-nest/Dockerfile` | `node:20-alpine`, exposes 3003, has a `HEALTHCHECK`, runs `dist/main.js` |
| Dev stack | `docker-compose.dev.yml`, started by `npm run dev:up` | PostgreSQL, `backend-nest` and Appwrite (included from `docker-compose.appwrite.yml`) |
| "Prod" compose | `docker-compose.prod.yml` | Still a copy of the dev stack: it loads `backend-nest/.env`, uses the image tag `:dev` and includes the dev Appwrite. See [docs/DECISIONS.md](docs/DECISIONS.md). Not usable as-is |
| Console image | `frontweb/Dockerfile` | `node:22-alpine`, exposes 3000, runs `node .output/server/index.mjs` |
| Mobile build | `frontmobile/` (Expo) | The repo docs show `eas build --platform android|ios --profile preview`. No production EAS profile is verified |

## 2. Production behaviour already enforced in code

These switch on when `NODE_ENV=production` or `BITNOB_ENVIRONMENT=production`:

- `NODE_ENV=production` loads `backend-nest/.env.prod` and the database `dioteko_prod`. See [SETUP.md](SETUP.md).
- `CERT_AUTO_ISSUE` is off unless set to exactly `true`. Types without review wait for an agent.
- `PAYMENT_SIMULATION` is refused at boot.
- `APPWRITE_REQUIRE_GOOGLE_IDENTITY` is forced to `true`.
- A Bitnob webhook with no `BITNOB_WEBHOOK_SECRET` is rejected (fail closed).
- With `BITNOB_ENVIRONMENT=production`, `APP_BASE_URL` must be HTTPS, and Bitnob payout `finalize`, withdrawals and bulk transfers are disabled ([docs/ARCHITECTURE_AS_BUILT.md §6.1](docs/ARCHITECTURE_AS_BUILT.md)).
- CORS allows no origin unless `CORS_ORIGINS` is set.
- The seed refuses to run in production.
- `synchronize` is off. The schema changes only through migrations.

## 3. Checklist before a first deployment

- [ ] Write a real production compose file. It must not load the dev env, must have its own image tag, must not include the dev Appwrite, and must not use dev passwords.
- [ ] Mount a persistent volume for certificate PDFs. Today they are written to the container filesystem and are lost when the container is recreated.
- [ ] Close the cross-tenant revoke gap (see [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)).
- [ ] Decide whether Bitcoin anchoring stays simulated. If it does, say so in every user-facing place.
- [ ] Bitnob live: follow [docs/BITNOB_PASSER_EN_LIVE.md](docs/BITNOB_PASSER_EN_LIVE.md). Allow the server IP, set the HTTPS webhook URL and `BITNOB_WEBHOOK_SECRET`.
- [ ] Appwrite: use a production instance. Disable the auth methods other than Google, and use an API key limited to `users.read`. See the "Production hardening checklist" in [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md).
- [ ] Generate new `JWT_SECRET` and `VC_SIGNING_SECRET` values outside the repo. Never reuse dev values.
- [ ] Set `APP_BASE_URL` to the public HTTPS origin, and set `CORS_ORIGINS` to the exact console origin.
- [ ] Put an HTTPS reverse proxy in front of port 3003. The proxy is not in the repo.
- [ ] Mobile: build with the production `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_APPWRITE_ENDPOINT`, both HTTPS.
- [ ] Monitoring: `GET /api/healthz` for liveness and database check. Logs carry `[START]`, `[CALL]`, `[RESULT]` and `[STATE]` tags.
- [ ] Review the open items in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).

## 4. Commands

Run these from `backend-nest/`. On Windows PowerShell, set the variable first with `$env:NODE_ENV="production"`. The test scripts use `cross-env` for the same purpose.

```bash
npm run build                      # compile to dist/
NODE_ENV=production npm run migration:run   # apply migrations, reads .env.prod
NODE_ENV=production npm run start:prod      # node dist/main.js
```

Console:

```bash
cd frontweb
npm ci && npm run build
PORT=3000 npm start
```

Remember that `VITE_*` values are fixed at build time.

## 5. Not verified

- No production host, domain, CI pipeline or secret store is defined in the repo.
- `docker-compose.prod.yml` has never been run as a production stack.
- A real Bitnob Lightning payment has not been observed (sandbox only).
- No production mobile build has been verified.
