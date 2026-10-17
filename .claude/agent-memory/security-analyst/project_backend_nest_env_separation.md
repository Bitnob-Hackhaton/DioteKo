---
name: backend-nest-env-separation
description: backend-nest dev/test/prod .env-file separation increment (env-files.ts + NODE_ENV selection) security review — fail-closed analysis and the conditions it must ship with
metadata:
  type: project
---

Increment adds `backend-nest/src/config/env-files.ts` `envFilePathForNodeEnv(nodeEnv)`
-> `.env.test` (test) / `.env.prod` (production) / `.env` (else). Wired into
`app.module.ts` `ConfigModule.forRoot({ envFilePath })`, `database/data-source.ts`
and `seeds/seed.ts` (`dotenv.config({ path })` replacing `import 'dotenv/config'`),
plus committed `.env.test.example` / `.env.prod.example` (backend-nest + repo root)
and `.gitignore` negations. Verdict: FIX-THEN-SHIP.

**Fail-closed IS achieved for the Nest app.** `env.validation.ts` makes
`APP_BASE_URL` / `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_NAME`
/ `JWT_SECRET` / `VC_SIGNING_SECRET` `@IsNotEmpty()`; a blank `.env.prod` -> boot
throws. `docker-compose.prod.yml` forces `NODE_ENV=${NODE_ENV:-production}`.
Dev values only leak into prod if a human actively writes them into `.env.prod`
or the root prod env — not via a silent fallback. `configuration.ts` `|| 'localhost'`
/ `|| 'dioteko_dev'` fallbacks are unreachable for the app (validation runs first).

**BLOCKING conditions:**
1. `.dockerignore` only excludes `.env` — `COPY . .` in the Dockerfile bakes any
   local `.env.test` (git-committed test JWT/VC secrets) and `.env.prod` into
   distributable image layers. Add `.env.*` (keep `!.env.*.example` semantics or
   just exclude `.env.test` / `.env.prod` / `.env.dev` explicitly).
2. `seeds/seed.ts` + `seed-baseline.ts` have NO `NODE_ENV==='production'` guard.
   The increment newly lets `seed.ts` load `.env.prod` and target a real DB.
   `seedBaseline` writes `admin-demo@dioteko.local` / `demo-password-change-me`
   (bcrypt) with ADMIN role, and `POST /api/auth/login` is `@Public()` +
   `bcrypt.compare` — seeding prod = instant admin compromise. Add a hard throw.

**NON-BLOCKING / should-fix:**
- `data-source.ts` (runs outside Nest, no validation): `DB_HOST` -> `localhost`,
  `DB_NAME` -> `dioteko_dev`, creds -> `postgres/postgres` when env unset.
  `migration:revert` against the wrong DB is destructive. Fail closed when
  `DB_NAME` unset.
- `seed.ts` `dotenv.config()` is placed AFTER `import { AppModule }` (CommonJS:
  require runs first). Works only because nothing at module-eval reads dotenv
  vars (only external `NODE_ENV`). The code comment claims the safe ordering the
  code doesn't do. Move `dotenv.config()` above the AppModule import.
- E2E DB guards (`test/global-setup.ts`, `test/utils/create-test-app.ts`) check
  `NODE_ENV==='test'` only, not `DB_NAME`. `reset-database.ts` does
  `TRUNCATE ... CASCADE`. Add a `DB_NAME` assertion for defense-in-depth.
- Committed `e2e-test-only-*` secrets in `.env.test.example`: acceptable
  (NODE_ENV=test never deployed, Bitnob sandbox gate, tokens verified in-process).
  Keep the invariant "no deployed process runs NODE_ENV=test".
- `.env.prod.example` ships `APP_BASE_URL=https://api.dioteko.example` — a
  placeholder that passes `@IsNotEmpty()`; prefer blank so a forgotten value
  fails closed (it feeds the Bitnob payout `callback_url`).
- `docker-compose.prod.yml` `environment:` hardcodes `DB_HOST=${DB_HOST}` etc.
  which override `env_file: .env.prod` — operator who fills `.env.prod` but not
  root `${...}` vars gets empty overrides -> confusing fail-closed. Pick one
  source of truth.
- `scripts/appwrite-seed.ts`: API-key handling is clean (never logged/echoed);
  add a `NODE_ENV!=='production'` guard, prefer `error.code`/`error.type` over
  `error.message`, TOCTOU between `users.list` and `users.create`.

**MUST-VERIFY (couldn't run git in review):** `git ls-files | grep env` shows
NONE of `backend-nest/.env`, `.env.test`, `.env.prod`, root `.env.dev` /
`.env.test` / `.env.prod`. The pre-existing real Bitnob sandbox secret
reportedly still in `backend-nest/.env` — if any `.env*` was ever committed
historically (`git log --all --`), rotate it.

Related: [[backend-nest-rewrite]], [[bitnob-webhook-verification]].
