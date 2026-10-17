# Implementation Notes — DioteKo

Technical details worth remembering, not obvious from a quick read of the code.

## backend-nest/ — module layout, authentication, and integration mechanics

See `docs/DECISIONS.md` for why TypeORM was chosen; see `docs/KNOWN_ISSUES.md` (§`backend-nest/`) for
open items (cross-tenant credential revoke, placeholder Appwrite config, Bitnob prod-gate-lift
blockers). Bitnob webhook signature verification: see `docs/BITNOB.md`.
This section documents the *how* — the concrete file paths and runtime flows.

### Module folder layout

Modules live in a flat `src/modules/*` layout: `identity`, `did-vc`, `lightning`, `bitnob`, `consent`,
`admin-certificates`, `kyc` and the domain stubs `{health,education,transport,employment,social-aid,merchant}`.

Global shared utilities live in `src/common/` (decorators, guards, entities, filters,
interfaces, utils). Database setup in `src/database/` (migrations, seeds, data-source.ts).

### BaseEntity: shared abstract base for standard timestamps

`src/common/entities/base.entity.ts` defines a shared `BaseEntity` that all entities
with the standard `id` (uuid PK) + `created_at`/`updated_at` (timestamptz) pattern extend.
**Not** every entity qualifies:

- **Entities that DO extend `BaseEntity`** (12 total):
  - `User`, `Organization`, `Did`, `VerifiableCredential`, `AdminCertificateRequest`,
    `LightningInvoice`, `Payment`, `BitnobClient`, `BitnobCard`, `BitnobTrade`, `BitnobPayout`,
    `Consent`

- **Entities that deliberately do NOT extend `BaseEntity`** (reason in parentheses):
  - `AdminCertificateRef` — append-only reference, has `id` + `created_at` but no `updated_at`
  - `BitnobWebhookEvent` — raw event log, uses `received_at` (not `created_at`/`updated_at`)
  - `AccessLog` — append-only audit log, no update column
  - `Role`, `UserRole`, `Session` — static lookup/session tables, no timestamps
  - `VerifiablePresentation` — append-only audit, no update column
  - Domain `*-record-ref` entities (e.g., `EducationRecordRef`, `TransportRecordRef`) —
    append-only references, only `id` (no timestamps)

This is intentional, not an oversight — check the actual entity file if unsure why a particular
table doesn't fit the base pattern.

### Global guards: JWT auth + roles, opt-out via `@Public()` decorator

Every route is JWT-protected by default (see `docs/DECISIONS.md` for rationale). The two-guard system:

1. **JwtAuthGuard** (`src/common/guards/jwt-auth.guard.ts`):
   - Registered globally as `APP_GUARD` in `src/app.module.ts` (line 72)
   - Wraps Passport's `jwt` strategy (`src/modules/identity/strategies/jwt.strategy.ts`)
   - Checks `Reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, class])` — if true, skips
     JWT validation entirely for this route
   - Otherwise calls `super.canActivate()` to validate the access token

2. **RolesGuard** (`src/common/guards/roles.guard.ts`):
   - Registered as `APP_GUARD` in `src/app.module.ts` (line 73)
   - Runs *after* `JwtAuthGuard` (order matters — `request.user` is only populated if JwtAuthGuard
     succeeds or route is `@Public()`)
   - Looks for `@Roles(RoleCode.ADMIN)` on handler/class, enforces against `request.user.roles`

**Routes marked `@Public()`**:

- **auth.controller.ts** (4): `POST /auth/login`, `POST /auth/appwrite/login`,
  `POST /auth/refresh`, `POST /auth/logout`
- **admin-certificates.controller.ts** (3): `GET /:certificateId/file`, `GET /:certificateId/verify`,
  `POST /api/admin-certificates/{certificateId}/verify`
- **bitnob-webhooks.controller.ts** (2): `POST /bitnob/webhooks` (catch-all, dispatches by `event`
  name), `POST /bitnob/webhooks/cards` — both `@Public()` but guarded by
  `BitnobWebhookSignatureGuard` (`x-bitnob-signature` HMAC-SHA512)
- **Domain shell controllers**: `GET /api/{health|education|transport|employment|social-aid|merchant}`
  (each a single `GET` returning `{ "implemented": false }`)

The absence of `@Public()` means the route is protected by default — this is the baseline, not
an exception.

### Appwrite + Google OAuth backend flow (identity module)

`src/modules/identity/` supports Appwrite-brokered Google OAuth.
See `docs/DECISIONS.md` for why email collision handling exists.

#### Step-by-step: Appwrite OAuth flow (mobile → backend)

**Mobile phase** (`frontmobile/services/appwriteAuth.ts`, line 46):

1. **Best-effort cleanup:** Before starting OAuth, delete any stale Appwrite session
   (recovers from interrupted logins). Wrapped in try-catch to avoid blocking.
2. **Redirect URI:** Generate via `Linking.createURL('auth/google/callback')` (deep-link).
3. **OAuth token request:** Call `account.createOAuth2Token({ provider: 'Google', success, failure })`
   where `success` and `failure` are the redirect URIs returned by Appwrite OAuth flow.
4. **Browser:** Call `WebBrowser.openAuthSessionAsync(loginUrl, redirectUri)` — user sees Google sign-in,
   grants permission.
5. **Callback parse:** Browser redirects back with `?userId=...&secret=...`. Extract both.
6. **Create session:** Call `account.createSession({ userId, secret })` — establishes Appwrite session
   locally in the SDK.
7. **Mint JWT:** Call `account.createJWT()` — returns `jwt.jwt` (short-lived: Appwrite JWTs last 15 minutes and die with their session).
8. **Cleanup on failure:** If any step after `createSession` fails (e.g., network error during `createJWT`, or the backend rejecting the login),
   call `account.deleteSession({ sessionId: 'current' })` (best-effort, 5s timeout) to clean up the orphaned Appwrite session before re-throwing.

**Backend phase** (`src/modules/identity/controllers/auth.controller.ts`, line 31):

1. **Mobile POSTs:** `POST /api/auth/appwrite/login` with body `{ "appwriteJwt": "eyJ0eXAi..." }`.
   DTO: `AppwriteLoginDto` (defined in `src/modules/identity/dto/appwrite-login.dto.ts`).

2. **Verify against Appwrite** (not local decode):
   - `auth.controller.ts` calls `appwriteService.verifyClientJwt(dto.appwriteJwt)`.
   - `AppwriteService.verifyClientJwt()` (`src/modules/identity/services/appwrite.service.ts`, line 27):
     1. Create a new Appwrite `Client` (ephemeral, one per verification).
     2. Call `.setEndpoint(config.appwrite.endpoint)`.
     3. Call `.setProject(config.appwrite.projectId)`.
     4. Call `.setJWT(appwriteJwt)` — use the client JWT for auth.
     5. Create `Account` instance with that client.
     6. Call `account.get()` — **live round-trip** to Appwrite's `/account` endpoint.
     7. Read `emailVerification` and `status` (boolean, `true` = enabled) from the response; a missing value counts as not verified / not active.
     8. Call `account.listIdentities({ queries: [Query.equal('provider', 'google')] })` (own try/catch) — fetch the
        user's Google identity and take its `providerUid`, which is the Google `sub` (subject ID).
     9. **Never read or log** provider access/refresh tokens or the provider email (the identity objects contain them).
     10. Return `{ appwriteUserId, email, name, emailVerified, accountActive, googleId }` (`googleId` is `null` when there is no Google identity).
     11. If `appwrite.requireGoogleIdentity` is on (default, always in production) and there is no Google identity or the lookup failed,
         reject with the same generic `UnauthorizedException` as any other failure.
     12. On any failure (invalid JWT, network, Appwrite down), throw `UnauthorizedException('Invalid or expired Appwrite session')`.
     13. Log calls with `[CALL]` and results with `[RESULT]` tags (ids and flags only, no PII).

3. **Complete login** (find-or-create user, assign roles, link Google, mint JWT):
   - `auth.controller.ts` calls `authService.completeAppwriteLogin(identity)` with the verified identity above.
   - `AuthService.completeAppwriteLogin()` (`src/modules/identity/services/auth.service.ts`):
     1. **Unverified or disabled Appwrite account → 403:** if `emailVerified` or `accountActive` is false, throw a generic
        `ForbiddenException` before anything is written.
     2. **Lookup or create user:**
        - Query by `appwrite_user_id` (the primary key for this identity path).
        - If found: `assertActive` (local `account_status`, → 403 if suspended), then the `google_id` link-once rules: unset + identity has one →
          set it once; same value → ok; different or missing on an already-linked user → 403, never overwritten. `users.email` is never re-synced.
        - If not found: look the email up case-insensitively (`lower(trim(email))`). If it belongs to another user → `ConflictException` (409,
          no auto-link). Otherwise create the user with `appwrite_user_id`, lowercased `email`, `display_name`, `google_id` (the Google `sub`),
          `email_verified = true`, `last_login_at`. A concurrent first login hitting a Postgres `23505` re-reads by `appwrite_user_id` and continues;
          with no winner it returns a generic 409 (no email in the message or logs).
     3. **Assign holder role:** `ensureRole(userId, RoleCode.HOLDER)` (idempotent, tolerates `23505`).
     4. **Find or create DID:** `DidService.findByController(userId)`, else `DidService.createDid(userId)` (no unique constraint on
        `dids.controller_user_id` yet — see KNOWN_ISSUES).
     5. **Update login timestamp:** `last_login_at = now()` (both for new and existing users).
     6. **Mint tokens** (`mintTokens`, which re-checks `account_status`):
        - `AccessToken`: HS256-signed JWT, `JWT_ACCESS_TTL` (default 15 min), contains `{ sub, roles, did }`.
        - `RefreshToken`: opaque rotating token (`<sessionId>.<secret>`), bcrypt-hashed in the `sessions` table, `JWT_REFRESH_TTL` (default 30 days).
     7. **Build response:** `{ success: true, accessToken, refreshToken, expiresIn, user: AuthUserDto }` where `AuthUserDto` is built field by
        field (`id, email, displayName, emailVerified, accountStatus, googleLinked, roles, did`) — the TypeORM entity never leaves the service.
     8. Log transitions with `[START]`/`[RESULT]`/`[STATE]` tags (ids only).

4. **Response to mobile:** Mobile stores the session via `tokenProvider.setSession({ accessToken, refreshToken, user })`
   (tokens in SecureStore, user snapshot in AsyncStorage) and sends `Authorization: Bearer <accessToken>` to the API from then on.

#### User entity schema

`src/modules/identity/entities/user.entity.ts`:
- `id` (uuid PK, via BaseEntity)
- `email` (varchar, nullable, unique) — email from Google/Appwrite
- `phone` (varchar, nullable, unique) — not provided by Appwrite
- `password_hash` (varchar, nullable) — for future email/password login (not wired yet)
- `display_name` (varchar, nullable)
- `appwrite_user_id` (varchar, nullable, unique) — Appwrite user ID (only set for Google/Appwrite-login users)
- `google_id` (varchar, nullable, unique) — Google OAuth subject ID (`sub` claim, extracted from Appwrite identity)
- `email_verified` (boolean, default false) — whether email is confirmed in Appwrite (used at login to enforce)
- `account_status` (varchar, default 'active') — local account state, `'active'` | `'suspended'`; enforced (see below)
- `last_login_at` (timestamptz, nullable) — most recent successful **Appwrite/Google** login (not updated by email/password login)
- `organization_id` (uuid, nullable FK) — organization affiliation (nullable)
- `created_at`, `updated_at` (timestamptz, via BaseEntity)

**Column meanings:**
- **`google_id`**: Set when user logs in via Google OAuth. Unique constraint to prevent duplicate Google identities.
- **`email_verified`**: Read from Appwrite's `emailVerification` field at login. If false, login is rejected with 403.
- **`account_status`**: Local to DioteKo (not read from Appwrite). Anything other than `'active'` is refused: `AuthService.assertActive`
  runs right after the user is loaded in the Appwrite login (before role/DID side effects), and `mintTokens` re-checks it
  for every path including refresh. There is no admin endpoint to suspend yet; a future one must also revoke the user's `sessions` rows.
  Access tokens already issued stay valid until they expire (15 min), because `JwtStrategy` does not read the DB.
- **`last_login_at`**: Set by `completeAppwriteLogin` only. Useful for activity reports and cleanup policies.

Identity is Appwrite + Google, plus staff email and password.

#### Configuration

**Backend** (`src/config/configuration.ts` and `src/config/env.validation.ts`):
- `APPWRITE_ENDPOINT` (string, required if using Appwrite) — Appwrite instance URL (e.g., `https://appwrite.example.com/v1`)
- `APPWRITE_PROJECT_ID` (string, required if using Appwrite) — Appwrite project ID
- `APPWRITE_API_KEY` (string, optional) — Appwrite server API key (not needed for client JWT verification)
- `APPWRITE_REQUIRE_GOOGLE_IDENTITY` (boolean, default true) — **fail-closed behavior:**
  - If `true` (or unset): `POST /api/auth/appwrite/login` requires `emailVerified === true` and `googleId` present.
    Rejects unverified emails with 403. Designed for production.
  - If `false`: allows Appwrite login without email verification, and does not require `googleId`.
    Intended for E2E testing with seeded Appwrite users that don't have Google identity linked.

If `APPWRITE_ENDPOINT` or `APPWRITE_PROJECT_ID` are unset, `AppwriteService.verifyClientJwt()` will fail
at runtime with an empty string, causing Appwrite Client initialization to fail.

**Mobile** (`frontmobile/.env`):
- `EXPO_PUBLIC_APPWRITE_ENDPOINT` — Appwrite instance URL (e.g., `http://localhost:8090/v1` for dev, `https://appwrite.example.com/v1` for prod)
- `EXPO_PUBLIC_APPWRITE_PROJECT_ID` — Appwrite project ID (same as backend)
- `EXPO_PUBLIC_API_BASE_URL` — DioteKo backend base URL (e.g., `http://localhost:3001/api` for dev)

**Never put API keys in `EXPO_PUBLIC_*` env vars** — they are baked into the app bundle. Use server API keys only on the backend.

#### Migration: adding `appwrite_user_id` column

`src/database/migrations/1786839271278-AddAppwriteUserId.ts`:
```sql
ALTER TABLE "users" ADD "appwrite_user_id" character varying;
ALTER TABLE "users" ADD CONSTRAINT "UQ_..." UNIQUE ("appwrite_user_id");
```
Reversible via the `down()` method. Additive, no data loss risk.

### Appwrite + Google OAuth mobile flow (frontmobile)

`frontmobile/services/appwriteAuth.ts` implements the full client-side OAuth dance and session management.

#### OAuth sign-in flow

The `signInWithGoogle()` function (line 46) orchestrates the entire OAuth→JWT dance:

1. **Validate config:** Check `APPWRITE_ENDPOINT` and `APPWRITE_PROJECT_ID` are set (throw if not).
2. **Best-effort cleanup:** Delete any stale Appwrite session from a prior interrupted login (try-catch, no-throw).
3. **Generate redirect URI:** Call `Linking.createURL('auth/google/callback')` (creates a deep-link).
4. **OAuth token creation:** Call `account.createOAuth2Token({ provider: OAuthProvider.Google, success, failure })`.
   Appwrite returns a `loginUrl` (Google consent screen).
5. **Open browser:** Call `WebBrowser.openAuthSessionAsync(loginUrl, redirectUri)`. User sees Google sign-in,
   grants permission, browser redirects back to the app.
6. **Parse callback:** Extract `?userId=...&secret=...` from the redirect. Throw if either is missing.
7. **Create session:** Call `account.createSession({ userId, secret })` — establishes Appwrite session locally.
8. **Mint JWT:** Call `account.createJWT()` — returns `{ jwt: "..." }`, a short-lived Appwrite JWT (15 minutes, tied to the session).
9. **POST to backend:** Send `POST /api/auth/appwrite/login { "appwriteJwt": "..." }` (flagged `_skipAuth`, so no Bearer header) to get the DioteKo tokens.
10. **Store session:** `tokenProvider.setSession({ accessToken, refreshToken, user })` (see storage below). A missing `accessToken`, `refreshToken` or `user` in the response is an error.
11. **On failure after `createSession`** (createJWT, backend rejection such as 409/403, network, invalid response, storage failure): call
    `account.deleteSession({ sessionId: 'current' })` (best-effort, 5s timeout) so the orphaned Appwrite session cannot block a retry, then re-throw the original error.
12. **Return:** `{ user, accessToken }` for the caller to update UI.

#### Error handling

- **Network errors (no server response):** Catch `axios` errors with no `response` object — log `"Serveur indisponible ou timeout..."`.
- **Server errors (5xx):** Catch `response.status >= 500` — log `"Probleme serveur temporaire..."`.
- **400/401/403/409 (client errors):** Extract `response.data.message` from backend and re-throw as-is, or fall back to generic message.
- **All errors:** Log full details (statusCode, backendMessage, apiBaseUrl) to console; user sees French toast.
- **Non-axios exceptions:** Catch all other errors and wrap in a generic `Error`, log stack.

#### Session storage and request interceptors

**Storage** (`frontmobile/lib/token-provider.ts`). The secrets and the user snapshot are split because SecureStore warns above ~2048 bytes:
- `{ accessToken, refreshToken }` → **SecureStore**, key `auth_tokens`, `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- The non-secret user snapshot → **AsyncStorage**, key `auth_user`.
- If the SecureStore write fails, `setSession` throws (login fails; there is no memory-only session). A stray `user_session` key is ignored and deleted.
- `getSession()` returns the in-memory session, else reads both stores (null if the tokens or the user snapshot is missing).
  An `epoch` counter makes a read that races `setSession`/`clearSession` return null without caching it, so a cleared session cannot be resurrected.
- `updateTokens(tokens, expectedRefreshToken)` is compare-and-set on the in-memory refresh token: a refresh that finishes after a logout, or after a
  different user signed in, is discarded and returns `false`.
- `clearSession()` empties memory, `auth_tokens`, `auth_user` and the stray `user_session` key, and never throws.

**Request headers** (`frontmobile/services/api.ts`): a request interceptor on the shared axios instance adds `Authorization: Bearer <accessToken>`
**only** when the resolved URL is under `API_BASE_URL` (look-alike hosts and protocol-relative URLs get nothing) and the request is not flagged `_skipAuth`
(`/auth/appwrite/login`, `/auth/refresh`, `/auth/logout`). Appwrite and any other host never receive the token.

**401 handling (refresh flow)** (`frontmobile/services/api.ts`):
- On a 401 for an authenticated request that was not already retried (`_retry`): one **single-flight** refresh shared by all concurrent requests
  (`POST /auth/refresh` through a bare axios call, so no interceptor loop). The backend rotates the refresh token, so the new pair is persisted with
  `updateTokens` **before** the original request is replayed once.
- If the stored access token already differs from the one the request was sent with, the request is simply replayed (another request already refreshed).
- If `updateTokens` returns `false` (session cleared or changed during the refresh), the original request is rejected instead of replayed.
- **Terminal:** a 401/403 from `/auth/refresh` (expired, revoked, or suspended account), or a session with no refresh token, clears the session and fires the
  session-expired handler registered by `GlobalProvider` (which sets `user` to null and sends the user back to sign-in). This only happens if the refresh
  token that was refused is still the current one.
- **Not terminal:** a network error, timeout or 5xx on `/auth/refresh` keeps the session and fails only the original request.
- Known limit: if the rotation response is lost, the next refresh gets 401 and the user must sign in again (see KNOWN_ISSUES).

**Logout sequence** (`clearGoogleSession()` in `frontmobile/services/appwriteAuth.ts`, called by `GlobalProvider.logout()`), every step best-effort and never throwing:
1. wait for any in-flight refresh (`waitForRefresh()`), so a just-rotated token is not left alive on the server;
2. `POST /api/auth/logout { refreshToken }` (5s timeout) — the backend revokes the session;
3. `account.deleteSession({ sessionId: 'current' })` (5s timeout) — deletes the Appwrite session;
4. `tokenProvider.clearSession()` — always last; `GlobalProvider` then sets `user` to null and the route guard redirects to sign-in.

**Cold restart:** `GlobalProvider` calls `tokenProvider.getSession()` on mount; if tokens and the user snapshot are both present the app is logged in without a new sign-in.

#### Configuration

**Mobile** (`frontmobile/config/config.ts`):
- `APPWRITE_ENDPOINT` — read from `EXPO_PUBLIC_APPWRITE_ENDPOINT` env var (e.g., `http://localhost:8090/v1` for dev)
- `APPWRITE_PROJECT_ID` — read from `EXPO_PUBLIC_APPWRITE_PROJECT_ID` env var
- `API_BASE_URL` — read from `EXPO_PUBLIC_API_BASE_URL` env var (e.g., `http://localhost:3001/api` for dev)
- `APPWRITE_PLATFORM` — hardcoded to `'com.dioteko.app'` (must match bundle identifier in Appwrite console and app.json)
  - iOS: `frontmobile/app.json` → `"ios.bundleIdentifier": "com.dioteko.app"`
  - Android: `frontmobile/app.json` → `"android.package": "com.dioteko.app"`

**Never put API keys in `EXPO_PUBLIC_*` env vars** — they are baked into the app bundle.

#### UI and dependencies

**Components** (`frontmobile/components/reactnativereusables/components/social-connections.tsx`):
- Google button (`oauth_google`) is functional and wired to `signInWithGoogle()`.
- Other strategy buttons show "not yet integrated" toast if tapped.

**Dependencies:**
- `react-native-appwrite` — Appwrite SDK for React Native (not Expo, requires `npm install` due to EALLOWSCRIPTS)
- `react-native-url-polyfill/auto` — polyfills URL constructor in React Native
- `expo-web-browser` (`WebBrowser.openAuthSessionAsync`)
- `expo-linking` (deep-link URI parsing)
- `axios` (HTTP client for API calls)
- `@react-native-async-storage/async-storage` (AsyncStorage for token persistence)

#### GET /auth/me — current user profile

The `GET /auth/me` endpoint (protected, JWT required) returns the current user's full profile,
including Appwrite/Google linking status:

```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "phone": null,
    "displayName": "User Name",
    "organizationId": null,
    "roles": ["holder"],
    "did": "did:dioteko:...",
    "emailVerified": true,
    "accountStatus": "active",
    "googleLinked": true
  }
}
```

**Fields added for the Appwrite/Google flow:**
- `emailVerified` — `users.email_verified`, set from Appwrite's `emailVerification` at each Appwrite login
- `accountStatus` — `users.account_status` (`active` | `suspended`)
- `googleLinked` — `true` if `google_id` is set (the user logged in with Google at least once); `google_id` itself is never returned

`GET /auth/me` does not return `lastLoginAt`. The Appwrite login response (`POST /auth/appwrite/login`) returns a similar `user` object
(`id, email, displayName, emailVerified, accountStatus, googleLinked, roles, did`) without `phone` / `organizationId`.

### Bitnob webhook event names

`src/modules/bitnob/services/bitnob-webhook.service.ts` dispatches Bitnob events by the
**namespaced `event` key**, not a bare name. Examples: `payouts.initialized`, `transfer.success`.
See `docs/BITNOB.md` (§"Webhooks — dispatch logic") for the full routing table.

**Guard mechanics:** `BitnobWebhookSignatureGuard` verifies the
`x-bitnob-signature` header (HMAC-**SHA512** over the raw request body) before any handler runs.
Raw body verification requires `rawBody: true` in `main.ts` NestFactory. A critical gotcha:
`Buffer.from(hexString, 'hex')` silently truncates on invalid input, so the guard checks both
a `/^[0-9a-f]{128}$/i` regex (SHA512 hex is always 128 chars) AND an explicit length check
before `timingSafeEqual`. See `src/modules/bitnob/guards/bitnob-webhook-signature.guard.ts`.

The verified payload is persisted to `bitnob_webhook_events` with `signature_valid` boolean,
allowing audit trails of unverified (dev) vs verified (prod) deliveries.

---

## Review-gate convention: M# (security) and A# (migration) IDs in code comments

Non-trivial backend-nest increments (money-moving, auth, migration work) use a **multi-agent
review pipeline** with labeled conditions in code comments:

**M# (security-analyst conditions):** Labeled M1, M2, M3, etc., in code comments when
`@security-analyst` reviews the code. Example: `// M4 — row-before-call ensures idempotency`.
These conditions must be **actually met** in the implementation before `@code-reviewer` approves.

**A# (migration-reviewer conditions):** Labeled A1, A2, A3, etc., when `@migration-reviewer`
approves a TypeORM migration. Example: `// A3 — FK is RESTRICT to prevent orphans`.

**Why:** Money-movement / auth / database-schema changes require specialist review before a
generalist code-reviewer pass. Labels make the chain auditable and scope the later reviews
(code-reviewer focuses on cross-feature interactions, tests, ledger completeness, not re-validating
M# or A# conditions that specialists already checked).

**In practice:**
1. `@security-analyst` runs first, emits M# conditions (e.g., "M1 prod gate as first line",
   "M2 atomic CAS").
2. `@migration-reviewer` runs next (if schema changes), emits A# conditions (e.g., "A1 FK must be RESTRICT").
3. `@implementer` folds both M# and A# into code comments at the relevant locations.
4. `@code-reviewer` verifies each M#/A# is actually met in the code + checks the rest (style, tests, logging).

See `.claude/agent-memory/code-reviewer/project_review_gate_convention.md` for the full
workflow and `CLAUDE.md` § 6 "Modèles par défaut pour les subagents" for which agents to use when.
