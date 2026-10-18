# Testing — DioteKo backend-nest

Two layers, both Jest, kept in separate configs so they never interfere.

| Layer | Command (in `backend-nest/`) | Config | DB | What it covers |
|---|---|---|---|---|
| **Unit** | `npm test` | `jest.config.js` (`roots: src`) | none | Pure-function and stubbed-DI specs — Bitnob HMAC, envelopes, webhook guard, payout math (run `npm test` for the current count) |
| **E2E** | `npm run test:e2e` | `test/jest-e2e.js` (`roots: test`) | `dioteko_test_bitnob` | real `AppModule` over HTTP (supertest), real Postgres |

`npm test` and `npm run test:e2e` are independent — the unit run never touches a database and never loads the `test/` folder.

---

## Environment model

`NODE_ENV` selects the env file — one resolver, `src/config/env-files.ts`, used by the app
(`ConfigModule`), the TypeORM CLI (`data-source.ts`) and the seed:

| `NODE_ENV` | file | database |
|---|---|---|
| unset / `development` | `backend-nest/.env` | `dioteko_dev_bitnob` |
| `test` | `backend-nest/.env.test` | `dioteko_test_bitnob` |
| `production` | `backend-nest/.env.prod` | `dioteko_prod` (deploy only) |

All three databases live on the **same** DioteKo Postgres instance (`dioteko-postgres-bitnob`, host port 5442, same user/password) —
only the database name differs. `.env` / `.env.test` / `.env.prod` are gitignored; copy the
committed `.env.example` / `.env.test.example` / `.env.prod.example`.

---

## How `npm run test:e2e` works

1. `cross-env NODE_ENV=test` (works on Windows) → `.env.test` → `dioteko_test_bitnob`.
2. `pretest:e2e` runs `migration:run` + `seed` against `dioteko_test_bitnob`.
3. `test/global-setup.ts` (once): asserts `NODE_ENV=test` **and** the resolved `DB_NAME` is
   `dioteko_test_bitnob` (refuses to run otherwise — this is what stops a missing `.env.test` from
   pointing the suite at `dioteko_dev_bitnob`), then re-applies migrations (idempotent, so
   `jest --watch` also works).
4. `--runInBand` — all specs share the one test DB, so they run serially.
5. Each spec: `beforeAll` boots the app, `beforeEach` calls `resetAndSeed`
   (`TRUNCATE … RESTART IDENTITY CASCADE` on every table + re-apply the baseline), `afterAll`
   closes the app.

### Writing a new E2E spec

Copy `test/health.e2e-spec.ts`. Helpers in `test/utils/`:

- `createTestApp()` → `{ app, dataSource }` — the real `AppModule`, wired exactly like `main.ts`
  (`applyGlobalAppConfig`).
- `resetAndSeed(app, dataSource)` — call in `beforeEach`.
- `resetDatabase(dataSource)` — truncate only, no re-seed.
- `loginAs(app, DEMO_LOGINS.admin | .issuer | .holder)` → bearer token for authed routes.

Baseline seed (`src/database/seeds/seed-baseline.ts`, shared with `npm run seed`): 4 roles, one
demo municipality org + issuer DID, and three demo email/password users
(`issuer-demo@` / `admin-demo@` / `holder-demo@dioteko.local`, password `demo-password-change-me`).

### Appwrite-login E2E

`test/appwrite-login.e2e-spec.ts` is **skipped** unless `APPWRITE_PROJECT_ID` + `APPWRITE_API_KEY` are set
in `.env.test`. It exercises the full `POST /api/auth/appwrite/login` backend flow.

**Requirements:**
- Appwrite must be running: `npm run dev:up` (starts the Appwrite services).
- One-time Appwrite console setup (see `DEV_WORKFLOW.md` → "Appwrite first-run" steps 1–4).
- `APPWRITE_PROJECT_ID` and `APPWRITE_API_KEY` in `backend-nest/.env.test`.
- `npm run seed:appwrite` has been run to create the test user `appwrite-e2e@dioteko.local` with email verified.
- `APPWRITE_REQUIRE_GOOGLE_IDENTITY=false` in `backend-nest/.env.test`
  (because the seeded test user has no Google identity linked — we're testing the Appwrite JWT path, not Google OAuth).

**What it asserts:**
- Seeded test user can be found via Appwrite's `account.get()` call (JWT verification works).
- Backend successfully creates a new User row linked to the Appwrite user ID.
- `email_verified` is set to `true` (read from Appwrite's `emailVerification` field).
- `google_linked` is `false` (no Google identity in test user).
- User gets the **holder** role.
- Response includes valid JWT tokens and correct user profile fields.
- **Negative:** Ensures that sensitive fields are NOT returned in the user object:
  - No `password_hash`, `appwrite_user_id`, or `google_id` in the response.

**What it does NOT cover:**
- Real Google OAuth (requires a physical device or emulator with a dev build — see `DEV_WORKFLOW.md` → "Testing Google login from a phone or emulator").
- Email collision scenarios (existing user with the same email from another provider).
- Refresh token flow (covered by separate auth E2E).
- Session invalidation or logout (covered by separate auth E2E).

---

## Unit tests (backend-nest)

Run with `npm test` (no database, uses stubbed dependencies).

**Identity / Auth module:**
- `src/modules/identity/services/auth.service.spec.ts` — password hashing, role assignment, token minting, error cases
- `src/modules/identity/services/appwrite.service.spec.ts` — JWT verification, error handling, response parsing
- `src/config/configuration.spec.ts` — env var parsing, default values, validation

Run `npm test` for the exact count (it changes with every change). The areas covered are:
- HMAC-SHA512 (Bitnob webhook signature verification)
- Envelope/VC serialization
- Webhook guard logic
- Payout math and balance tracking
- Auth service logic (password validation, role checks, token generation)

---

## Manual mobile testing (frontmobile)

**Important:** Mobile has no automated test runner. All testing is manual on a device/emulator or via E2E fixtures.

**Preconditions:**
- Dev build running on a phone or emulator (not Expo Go).
- Backend running (`npm run dev:up` + `npm run db:setup`).
- Appwrite configured with Google OAuth (see `DEV_WORKFLOW.md`).

**Login flow:**
- [ ] Tap "Google" button → browser opens with Google consent screen.
- [ ] Grant permission → redirected back to app.
- [ ] Tokens stored in SecureStore under the key `auth_tokens`; profile snapshot in AsyncStorage under `auth_user` (`frontmobile/lib/token-provider.ts`).
- [ ] Navigate to profile screen → shows logged-in user name and email.

**Session persistence (cold restart):**
- [ ] Log in and close app completely (terminate process).
- [ ] Reopen app → should show logged-in screen without re-login (tokens loaded from SecureStore).

**Refresh token (401 recovery):**
- [ ] Manually invoke a 401 scenario (e.g., delete the token from AsyncStorage, then call an API).
- [ ] Interceptor should trigger `POST /api/auth/refresh` with the refresh token.
- [ ] New access token should be received and stored.
- [ ] Original request should be replayed automatically.

**Airplane mode (session during network loss):**
- [ ] Enable airplane mode while logged in.
- [ ] Try to access a protected endpoint — should fail gracefully (network error, not logged out).
- [ ] Disable airplane mode, retry — should succeed (refresh flow + replay).

**Logout:**
- [ ] Tap "Logout" button → calls `POST /api/auth/logout` (backend invalidates session).
- [ ] Calls `deleteSession('current')` on Appwrite (cleans up Appwrite session).
- [ ] Clears AsyncStorage (tokens deleted).
- [ ] Redirects to sign-in screen.
- [ ] Verify the stores are empty: SecureStore `auth_tokens` and AsyncStorage `auth_user` both absent.

**Revoked/suspended account:**
- [ ] In Appwrite console, disable or suspend the logged-in user.
- [ ] Force a token refresh (e.g., call an API and trigger 401).
- [ ] Backend should return 403 (account suspended) instead of minting new tokens.
- [ ] App should detect 403, clear session, redirect to sign-in with error message.
- [ ] Verify no tokens are stored.

**Host isolation:**
- [ ] Add an API call to a non-backend host (e.g., `https://example.com/api/data`).
- [ ] Verify the request does NOT include `Authorization: Bearer` header (axios interceptor only adds it to API_BASE_URL).

**Note:** None of this has been run on a real device yet. These checks are aspirational; report issues found during device testing to `docs/KNOWN_ISSUES.md`.

---

## Good reflexes

- **Never** point a test at `dioteko_prod`. `NODE_ENV=production` is deploy-only.
- No secrets or tokens in spec files or fixtures — read from env, or use the seeded demo users.
- Never log passwords / tokens / API keys (the seed and `appwrite-seed.ts` follow this).
- `BITNOB_ENVIRONMENT` stays `sandbox` in `.env.test`. A money-move E2E must additionally assert
  it is not `production` before any POST — the production gate throws a `ForbiddenException` as
  the first line of every money-move method, so "prod" can't exercise transfers anyway.
- Keep the test DB name literally `dioteko_test_bitnob`; the guards assert it.

## Common pitfalls

- **Forgetting `NODE_ENV=test`** → the app loads `.env` and hits `dioteko_dev_bitnob`. `test:e2e` sets
  it for you; `global-setup.ts` + `createTestApp()` refuse to run if the resolved DB isn't
  `dioteko_test_bitnob`.
- **Missing `backend-nest/.env.test`** → `dotenv` is a silent no-op. The DB-name guard catches
  this and tells you to copy the example.
- **Sharing one DB between dev and test** → data pollution, flaky ordering. That's the whole
  reason for the separate database.
- **Not resetting between tests** → order-dependent specs. Always `resetAndSeed` in `beforeEach`.
- **A spec leaking an open transaction** → the next `beforeEach` `TRUNCATE` blocks on the lock
  rather than failing clearly. Close everything you open.
- **Bitnob sandbox limits** (if you write Bitnob E2E): `POST /bulk-transfers` → 403 "Feature Not
  Enabled"; no USDT/USDC balance → withdrawals 422 before any min-amount check; run the
  409/duplicate-reference test exactly once (it parks sandbox balance in a never-resolving
  pending withdrawal); throwaway testnet addresses only; never call bulk `confirm`.
- **`npm run migration:generate` to "check for drift"** can loop forever re-creating the
  `bitnob_payouts` / `bitnob_withdrawals` partial indexes (Postgres normalizes the `WHERE`
  predicate to `(status)::text <> …`). Not a real schema change — see the migration headers.
