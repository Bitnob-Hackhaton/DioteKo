# Decisions — DioteKo

Architecture decisions and durable technical arbitrations, with the reasoning behind them.
The newest entry is at the bottom.

Format for new entries:

```
## <short title>

**Decision:** what was chosen.
**Why:** the constraint or reasoning that drove it.
**Alternatives considered:** what else was on the table, if relevant.
```

## TypeORM for `backend-nest`

**Decision:** `backend-nest/` uses TypeORM 0.3.
**Why:** TypeORM matches the architecture prompt's stated convention for this architecture, and the
entity model is built fresh, so there is no ORM-switch cost.
**Alternatives considered:** Prisma — rejected to follow the architecture prompt.

## MVP scope: two fully-built domains, the others are shells

**Decision:** Of the 8 planned domains, `admin-certificates` and `kyc` (identity
verification, see the KYC entries below) are built end-to-end. `health`, `education`, `transport`,
`employment`, `social-aid`, `merchant` are placeholder shells (`GET /api/{domain}` → `{ "implemented": false, ... }`).
**Why:** Quality over breadth. `admin-certificates` maps directly to real, working logic
(certificate request → Lightning payment → VC issuance → PDF/QR → verification), whereas the
other domains have no reference implementation to build from.
**Alternatives considered:** Building thin stubs with fake data across all 8 domains for
demo breadth — rejected as producing eight shallow, untrustworthy domains instead of one
solid one.

## Bitcoin anchoring stays simulated; VC signing stays single-secret HS256

**Decision:** `certificate-anchor.service.ts` keeps returning a simulated/random txid — no real
Bitcoin testnet broadcast. VC signing uses a single shared `VC_SIGNING_SECRET` (HS256), not real
per-issuer-DID asymmetric crypto; `dids.document` remains a minimal JSON stub, not a
spec-compliant DID document.
**Why:** Honest scope. It avoids pretending the architecture adds cryptographic rigor that is not
actually built.
**Alternatives considered:** Implementing real testnet broadcast and per-DID asymmetric
signing — rejected as out of scope; it would need real key management and a funded testnet
wallet, neither in place.

## `backend-nest/` structure: `modules/` + shared `BaseEntity` + global guards, modeled on `Inventory_Rebalancing_Grid/backend`

**Decision:** A flat `src/modules/*` structure, a shared `BaseEntity` (id/created_at/updated_at)
that all entities extend, and global `APP_GUARD` registration with a `@Public()` opt-out
decorator (22 routes marked public) instead of per-controller `@UseGuards(...)`.
**Why:** The user asked to align `backend-nest/`'s architecture with their other project
`Inventory_Rebalancing_Grid/backend` — "it's just renaming but it is the same logic." Adopting
the reference project's coherent patterns (flat modules folder, shared base entity, global
guards) reduces duplication and matches a convention the user already likes elsewhere.
**Alternatives considered:** Copying the reference project's own acknowledged inconsistencies
too (a hexagonal repository-interface layer applied to only 4 of ~14 entities, two
independently-maintained entity-registration arrays, camelCase DB columns despite snake_case
table names) — explicitly rejected; `backend-nest` keeps its own better conventions (explicit
snake_case columns, single glob-based entity registration, `.env.example` + gitignored `.env`).
A `@security-analyst` review of the global-guards design caught that the original public-route
list was incomplete (it omitted the login routes, which would have broken login if implemented
literally) — fixed before shipping, verified via a live smoke test.

## Appwrite + Google OAuth as the identity path

**Decision:** `backend-nest/src/modules/identity/` logs users in through Appwrite + Google:
`users.appwrite_user_id`, `AppwriteService.verifyClientJwt` verifying a client-supplied Appwrite
JWT against the live Appwrite instance via a real `account.get()` round-trip (never local JWT
decoding), and `AuthService.completeAppwriteLogin` (role/DID bootstrap, only the `holder` role
ever granted).
**Why:** The user has a self-hosted Appwrite instance with Google OAuth wired.
**Alternatives considered:** Cross-linking identity columns so the same person logging in via
several providers resolves to one `User` row — deferred; see `docs/KNOWN_ISSUES.md`. A
`@security-analyst` review found (and a follow-up fix closed) an email-collision bug: an
unhandled DB constraint error was leaking a raw email into logs on a duplicate-email signup —
now a clean `ConflictException`.

## `backend-nest` in the root compose

**Decision:** `backend-nest` is a visible app service in the ROOT `docker-compose.dev.yml` —
`npm run dev:up` builds and starts it (image `dioteko-backend-nest-bitnob:dev`, port 3003) next to the
database. All dev tooling targets `backend-nest`: `db:setup`/`db:reset` run `migration:run` +
`seed` for `backend-nest`.
**Why:** The NestJS app must stay containerized (user requirement) and the root compose is the
one place where it is visible and started.

## Bitnob outbound HMAC: sign the exact wire bytes, never re-serialize

**Decision:** `BitnobHttpClientService` builds a string payload (`JSON.stringify(body)`),
passes it to `buildAuthHeaders(clientId, secret, payloadString)` which signs it, and sends
it via `axios.post(path, payload, { transformRequest: [(d) => d] })` so the signed bytes
match the wire bytes exactly. No re-serialization, no key sorting, no `stableStringify`.
**Why:** The Bitnob Postman collection signs the compact JSON body verbatim (insertion-order).
When axios re-serializes a DTO, insertion order is lost and every non-alphabetical payload
fails signature verification. The signed string **is** the wire string, guaranteed.
`Content-Type: application/json` is returned by `buildAuthHeaders` and is load-bearing with
the identity `transformRequest`.
**Alternatives considered:** Sorting DTO keys server-side before signing — creates a false
sense that the DTO and wire match (they don't, after `transformRequest`). Verifying signatures
in tests only — misses the invariant at runtime. See `src/modules/bitnob/services/bitnob-hmac.util.ts`.

## Bitnob DTOs: camelCase at the app boundary, snake_case on the wire

**Decision:** Input/controller DTOs are camelCase (backend-nest convention); the service
builds the snake_case wire body explicitly from validated fields. Never `post(path, dto)`
blindly. Likewise, response DTOs are camelCase; unwrapped Bitnob responses are snake_case
and sanitized via `unwrapBitnob()` before returning.
**Why:** With the HMAC rule settled, DTO casing no longer affects signature validity. Explicit
wire-body construction makes it clear what is sent to Bitnob and catches accidental field
leaks (e.g. organizationId, subjectDidId). `forbidNonWhitelisted + transform` + explicit
construction = confidence that validated and sent bytes are the same.
**Alternatives considered:** Send camelCase to Bitnob (compatibility unknown; Postman uses
snake_case). Accept snake_case DTOs throughout (violates backend-nest convention). See
`src/modules/bitnob/services/`.

## Bitnob payouts: 3-step flow with deferred finalize endpoint

**Decision:** Payout is 3 steps — `POST /api/payouts/quotes` (creates `quote`), `POST /api/payouts/:quoteId/initialize` (moves to `initiated`), `POST /api/payouts/:quoteId/finalize` (moves to `processing`, money disburses). `finalize` is a **separate explicit endpoint**, not chained into the create request path. The issuer can quote+initialize; only admin can finalize. Finalize pre-polls Bitnob status and only calls finalize if remote status is exactly `initiated`.
**Why:** Money disbursement must never be chained into a single HTTP call (irreversible, no recovery on timeout). A separate finalize endpoint makes the decision explicit and auditable. Pre-polling is the authority (reconcile-by-polling is the source of truth; webhooks are latency optimizations). `@security-analyst` verdict: separates the quote/initialize stages (issuer, safe) from the finalize stage (admin-only, prod-gated).
**Alternatives considered:** Single-call payout — rejected as dangerously chained. Automatic finalize after initialize — rejected; no money gate before the disbursement call.

## Bitnob production gate: hard-disable all money-move methods in production

**Decision:** `BITNOB_ENVIRONMENT=production` in config triggers a **hard throw** (Forbidden) as the **first line** of every money-move service method. **No real fiat or crypto moves in production.** The throw is the sole gate; the environment var must be checked before any external call.

Methods that throw in production (`this.environment() === 'production'`):
- `BitnobPayoutsService.finalizePayout` (disbursement step)
- `BitnobWithdrawalsService.createWithdrawal` (on-chain send)
- `BitnobBulkTransfersService.createDraft` (batch creation)
- `BitnobBulkTransfersService.confirmBatch` (irreversible batch disbursement)
- `BitnobBulkTransfersService.retryItems` (retry failed items)

**Why:** Bitnob production and sandbox share the same host and API key is the only differentiator. Until a full rehearsal is complete and all KNOWN_ISSUES prod-gate-lift blockers are resolved, real money disbursement must be structurally impossible. `@security-analyst` reviews gate every increment that touches money on this precondition.
**Alternatives considered:** Logging a warning (insufficient); removing/deferring until production is safe (same outcome, less explicit). See `backend-nest/src/config/configuration.ts`, `src/modules/bitnob/services/`.

## Bitnob payout per-certificate: one live payout via partial unique index

**Decision:** `bitnob_payouts` table has TWO separate partial-unique indexes:
- `UQ_bitnob_payouts_active_cert` on `adminCertificateRefId WHERE status NOT IN ('failed','expired')` — enforces at most one still-recoverable payout per certificate.
- `UQ_bitnob_payouts_reference` on `reference WHERE reference IS NOT NULL` — keeps Bitnob's only idempotency key globally unique.

One certificate can have multiple payout rows (failed attempts, retries), but only one can be non-terminal at a time. The `reference` is deterministic (`'dkpayout_' + id`) and persisted before the Bitnob call, so a 409 pre-check catches concurrent create attempts on the cert-scoped path.
**Why:** The per-certificate index (`adminCertificateRefId`) prevents duplicate initialization/finalization of the same certificate. The reference index (`reference`) synchronizes local idempotency with Bitnob's dedup — a random UUID would defeat Bitnob's retry detection. Deterministic reference + both indexes + pre-check = local guarantee of one live payout per certificate, protected at the DB level.
**Alternatives considered:** No cert index, rely on Bitnob dedup alone — loses local safety and audit trail. Single merged index — can't track both per-cert and global-dedup independently. See `src/database/migrations/`.

## Bitnob certificate payouts: beneficiary is env-configured, never caller-supplied

**Decision:** Payout destination (bank account) is read from env vars `BITNOB_PAYOUT_BENEFICIARY_{ACCOUNT_NUMBER,ACCOUNT_NAME,BANK_CODE,COUNTRY}`. The `createBitnobPayoutForCertificate` endpoint takes no beneficiary in the request body. All payouts route to the single platform account.
**Why:** `JwtPayload` has no `organizationId`. Any `issuer` (a shared role) can trigger payouts and would otherwise name their own bank account, draining treasury. Env-configured beneficiary is the interim fix until per-org payout accounts are modeled. `@security-analyst` verdict: org-scoped payouts require JWT.organizationId (deferred; documented in KNOWN_ISSUES).
**Alternatives considered:** Per-org configuration — requires JWT refactor. Caller-supplied + org-check — org not in JWT; rejected. See `backend-nest/src/config/`, `src/modules/admin-certificates/`.

## Bitnob raw money routes: @Roles(ADMIN) only, no cross-org gate available

**Decision:** Raw `POST /api/bitnob/payouts/quotes`, `POST .../payouts/:quoteId/initialize`, `POST .../payouts/:quoteId/finalize` are `@Roles(ADMIN)` only. Certificate-scoped payouts are `@Roles(ISSUER)` on the `POST /api/admin-certificates/:id/bitnob/payouts` path (and ADMIN can call both).
**Why:** Raw routes are not subject to the certificate → organization resolution logic. Without `organizationId` in the JWT, cross-org authz is structurally impossible today; ADMIN-only is the only safe tier. `@security-analyst` verdict: acceptable interim, revisit when JWT is enhanced.
**Alternatives considered:** Issuer can call raw routes (exposed the cross-org vulnerability). See `src/modules/bitnob/controllers/bitnob-money.controller.ts`.

## Bitnob families deferred: entities kept, no write path

**Decision:** Entities `BitnobTrade` and `BitnobCard` (and the used `BitnobClient`) remain in the schema. No write paths (create, update) are implemented for trades or cards. The deferred domains (trading, cards, virtual accounts, customers, beneficiaries) have no service methods and no routes, and `BitnobService` has no stubs for them. Bitnob Lightning invoices (pay-in) are implemented; see the entry "Bitnob Lightning pay-in".
**Why:** These domains are not in scope for the DID/VC certificate flow. Having no stubs avoids untested, non-functional API surface. The payout domain (which IS in scope) has complete read helpers: `supportedCountries`, `countryRequirements`, `banks`, `limits`, `accountLookup` in `BitnobPayoutsService` — those are live, not deferred. Keeping the entities is cheap optionality for a future increment.
**Alternatives considered:** Stub all routes (confusing; they fail/not-found). Drop the entities too (higher friction when reactivating). See `src/modules/bitnob/services/`.

## Bitnob client identity: persist whoami results in bitnob_clients

**Decision:** `BitnobIdentityService.whoami()` calls `GET /api/whoami`, unwraps the response, and upserts a `bitnob_clients` row with `client_id`, `client_name`, `environment`, `auth_method`, `active_company_id`. The row is read-only from the API perspective (no direct write routes).
**Why:** Proves the API key works and captures client metadata for observability. The persisted row is an audit trail of which Bitnob account is configured in this environment. The row can be repopulated on any restart.
**Alternatives considered:** No persist (fresh stat on every boot) — loses audit trail. User-supplied `bitnob_client_id` (not derived) — adds manual config friction. See `src/modules/bitnob/services/bitnob-identity.service.ts`.

## Bitnob webhooks: HMAC-SHA512 signature + event_id idempotency + reconcile is authority

**Decision:** `BitnobWebhookSignatureGuard` verifies `x-bitnob-signature` (HMAC-SHA512 hex over raw request body, separate from the request-signing SHA256 scheme) before any handler runs. `bitnob_webhook_events.signature_valid` tracks whether the guard passed. Duplicate `event_id` → idempotent 200 (not 500). Verified `transfer.success`/`transfer.failed` advance `bitnob_withdrawals` status forward-only (rank guard, like payouts). **Reconcile-by-polling (`GET /api/payouts/:id`, `GET /api/transactions?reference=`) is the authoritative source for any money decision; the webhook is a latency optimization.** A webhook flip never regresses a terminal status.
**Why:** Forged webhooks cannot flip payout/withdrawal status without HMAC verification. Without `event_id` dedup, Bitnob retries would cause duplicate money-table mutations (500 retry storms). Forward-only rank guards and reconcile-as-authority prevent a mismatch between Bitnob's state and local state. `@security-analyst` verdict: acceptable if the secret fallback is resolved (see KNOWN_ISSUES).
**Alternatives considered:** webhook-drives-money (rejected). No verification (rejected). See `src/modules/bitnob/guards/bitnob-webhook-signature.guard.ts`, `src/modules/bitnob/services/bitnob-webhook.service.ts`.

## Bitnob bulk webhooks deferred: only withdrawals receive transfer.* events

**Decision:** `transfer.success` / `transfer.failed` are routed to `bitnob_withdrawals` (matched by `reference` or `transaction_id`). Bulk `bitnob_bulk_batch_items` do NOT receive webhook updates. The `data.transaction_id ↔ bitnob_bulk_batch_items.withdrawal_id` identity is unverified (bulk writes are 403 in sandbox); webhook handling for bulk items is deferred until a live sandbox bulk probe confirms the identity.
**Why:** A mismatch between bulk items and their webhooks is a double-send vector. Until verified, reconcile-by-polling is the safe path. `@security-analyst` M4 condition.
**Alternatives considered:** Assume `transaction_id` matches item `withdrawal_id` (unverified, risky). Dual-write on both entities (doubles the replay surface). See `src/modules/bitnob/services/bitnob-webhook.service.ts`.

## Bitnob review-gate convention: M# (security) and A# (migration) IDs in code comments

**Decision:** Non-trivial `backend-nest/` increments use a multi-agent review pipeline (CLAUDE.md §3): `@security-analyst` runs first (conditions labeled M1, M2, ...), then `@migration-reviewer` (A1, A2, ...), then `@code-reviewer`. These IDs are written into code comments (e.g., `// M4 — local writes are transactional`). Code-reviewer confirms the M#/A# conditions are **actually met** in the implementation.
**Why:** Money-movement / auth / migration changes require specialist review before a generalist pass. Labels make the review chain auditable and the later code-reviewer's scope focused (cross-feature interactions, tests, ledger completeness).
**Alternatives considered:** No labels (review scope becomes implicit). All reviews in one pass (less specialized, higher risk on money/auth). See `.claude/agent-memory/code-reviewer/project_review_gate_convention.md`.

## Infra: three-database model (dev/test/prod), E2E harness, self-hosted Appwrite, env-file-driven compose

**Decision:** (1) Three databases on one Postgres: `dioteko_dev_bitnob`, `dioteko_test_bitnob`, `dioteko_prod`, selected by `NODE_ENV`. One resolver `backend-nest/src/config/env-files.ts` `envFilePathForNodeEnv()` used by the Nest app, TypeORM CLI, and seed. (2) E2E test harness (Jest, separate `jest-e2e.json`, `npm run test:e2e`): each spec calls `resetAndSeed` in `beforeEach` = `TRUNCATE ... RESTART IDENTITY CASCADE` over all mapped tables + re-`seedBaseline`. `test/global-setup.ts` and `test/utils/create-test-app.ts` refuse to run unless the resolved `DB_NAME === dioteko_test_bitnob`. (`npm run db:reset` is the separate destructive `dropdb`+recreate path for dev/test.) Seed logic lives in `src/database/seeds/seed-baseline.ts`, shared by CLI and E2E. (3) Self-hosted Appwrite in `docker-compose.appwrite.yml` (included by dev compose, port 8090). (4) `.env.dev` / `.env.test` / `.env.prod` templates committed; dev compose interpolates via `docker compose --env-file`. (5) Prod compose has minimal fixes (no `.env` mount, healthcheck → `/api/healthz`); no full rework. (6) Security/migration blocking fixes: `.dockerignore` excludes all `.env*`; `seed.ts` throws on `NODE_ENV=production`; `env.validation.ts` rejects signing secrets outside `NODE_ENV=test`; `data-source.ts` throws instead of fallback when DB vars unset.

**Why:** Without test isolation, unit specs are DB-less and there is no E2E path at all, and a shared dev/test DB causes data pollution and order-dependent tests. A three-database model on one instance keeps low-friction infra (one Postgres, one set of network/credentials) while enabling test isolation (name-based separation). Appwrite is live-accessed by `AppwriteService.verifyClientJwt` (real `account.get()` round-trip) and needs a local instance for E2E login tests. `.env` interpolation into compose avoids `docker-compose.override.yml` churn and keeps defaults working on fresh clones. The prod templates-only approach keeps prod configuration separate (never auto-created/seeded locally) without requiring manual env setup. Security fixes (production gate in seed, env-file scrubbing from images, DB var validation) prevent secrets leaks and accidental production writes during dev/test.

**Alternatives considered:** Separate Postgres instance per env (rejected — multi-instance friction). A single dev database plus only `dioteko_test_bitnob` (rejected — user wanted a clean dev/test/prod triplet). Mock database in E2E tests (rejected — E2E needs real Postgres for migration + seed fidelity). Point at remote/shared Appwrite for dev (rejected — user wanted self-contained). Manual `.env.dev` setup per clone (rejected — less friction with templates + defaults).

**Verification:** `npm run dev:up` starts the DB + Appwrite + backend-nest. `npm run db:setup` creates + migrates both `dioteko_dev_bitnob` and `dioteko_test_bitnob`. `npm run db:reset` truncates and re-seeds `dioteko_test_bitnob`. `npm run test:e2e` migrates `dioteko_test_bitnob`, asserts DB name before boot, runs real AppModule over supertest. `npm run seed:appwrite` idempotent, prod-guarded. `.dockerignore` verified to exclude `.env*`. `seed.ts` confirmed throws on `process.env.NODE_ENV === 'production'`.

**Files touched:** `backend-nest/src/config/env-files.ts`, `env.validation.ts`, `data-source.ts`; `scripts/docker-dev-up.js`; `docker-compose.dev.yml`, `docker-compose.appwrite.yml`; `.env.dev.example`, `.env.test.example`, `.env.prod.example`, `backend-nest/.env.test.example`, `backend-nest/.env.prod.example`; `.dockerignore`; `test/global-setup.ts`, `test/create-test-app.ts`, `jest-e2e.json`; `src/database/seeds/seed-baseline.ts`, `seed.ts`.

## Google identity as user columns, not a separate table

**Decision:** User `google_id` (unique, nullable), `email_verified` (bool, default false), `account_status` ('active'|'suspended', default 'active'), and `last_login_at` are columns on `users` table, not rows in a user_identities table. Migration `1788400000000-AddGoogleIdentityToUsers` adds them; the column pattern mirrors the existing `appwrite_user_id`.
**Why:** Simple, flat schema for a single identity provider. A separate identities table is the upgrade path if Apple/other providers are added later; one column per provider is acceptable interim.
**Alternatives considered:** `user_identities` table (one row per provider per user) — rejected as premature; the current model has no reason to split yet.

## No auto-link by email on duplicate identity

**Decision:** If an Appwrite/Google login's email already exists on another user, return HTTP 409 (ConflictException) and refuse to sign in. Email lookup is case-insensitive (`lower(trim(email))`); newly registered emails are stored lowercased. No auto-merging of users with matching emails across identity columns.
**Why:** Cross-linking users by email alone before email verification is a pre-hijack vector: an attacker registers a victim's email in Appwrite, then logs in as that victim's account locally. Explicit user intent (or admin merge) is required to connect identity columns. A fix removed a leaked email from error logs when this collision occurred.
**Alternatives considered:** Auto-link if email verified (insufficient; Appwrite account state is independent of our verification). Manual link endpoint (deferred).

## Appwrite is identity-proofing only; trust boundary in Appwrite config

**Decision:** Appwrite is trusted only to assert "this person owns this Google account." The real security boundary lives in Appwrite's own configuration: the production Appwrite project MUST have Email/Password, Anonymous, Magic URL, Email OTP, and Phone auth methods **disabled**. Only Google OAuth is enabled. `APPWRITE_REQUIRE_GOOGLE_IDENTITY=true` (always true in production; only an exact 'false' in dev/test relaxes it for the E2E email+password seed user).
**Why:** Pre-registration attack: if a victim's email can be created in Appwrite via an untrusted auth method (password signup, magic link, OTP), an attacker can pre-hijack the account before the victim ever tries to log in. Disabling all non-OAuth methods at the Appwrite config level closes that vector — a new Appwrite account MUST come from Google or nowhere. Configuration-level enforcement is more reliable than code-level gates.
**Alternatives considered:** Code-level check only (config drift risk). Allowing email+password in production (pre-hijack vector). See `backend-nest/src/modules/identity/services/auth.service.ts`.

## Login enforces Appwrite emailVerification and status gates before side effects

**Decision:** Before minting tokens or creating roles/DIDs, `AuthService.completeAppwriteLogin` asserts that the Appwrite user has `emailVerification=true` and `status='active'` (or returns HTTP 403 generic error, no detail). This gate runs after `AppwriteService.verifyClientJwt` confirms the JWT is valid and the user exists.
**Why:** A suspended or unverified Appwrite user should not gain backend access. The gate is placed before any side effect (role assignment, DID creation) so a failed gate is cheap. Login response reveals nothing about why it failed (403 generic), preventing enumeration of which emails exist in Appwrite.
**Alternatives considered:** Allowing unverified users to log in with limited scope (degrades security; different scope rules are hard to enforce consistently). Returning a specific error (makes enumeration easier).

## google_id is link-once; reuse or mismatch → 403

**Decision:** `users.google_id` is set on first login and never overwritten. If a second Google token arrives with a different `google_id`, or if `google_id` is missing on a user that already has one (suggesting the token's identity doesn't match), return HTTP 403 and refuse to sign in. Manual admin resolution required.
**Why:** Once a user's Google identity is linked, it should not change without explicit re-linking (deferred). A mismatch suggests either a JWT forgery or a confused client. Failing closed is safer than silently overwriting.
**Alternatives considered:** Auto-relink to the new google_id (silent identity change; risky). Soft warning and proceed (identity drift).

## account_status enforcement in AuthService and JwtStrategy limits

**Decision:** `account_status` is checked in `AuthService.mintTokens` (shared by login, Appwrite, refresh) before issuing tokens. Suspended users cannot mint new tokens. JwtStrategy (used by `@UseGuards(JwtAuthGuard)`) has **no** DB read — it decodes and validates the JWT only. A user suspended after login keeps a valid access token for up to 15 minutes (JWT_ACCESS_TTL). Any future admin suspend endpoint MUST also call `SessionsService.revokeUserSessions` to invalidate active tokens immediately.
**Why:** JwtStrategy doing a DB round-trip on every request is expensive and defeats JWT's purpose (stateless validation). The 15-minute window is acceptable — active endpoints are protected by refresh-token validation. Explicit session revocation on suspend is the path to revoke cached tokens.
**Alternatives considered:** JwtStrategy reads DB (expensive, adds latency to every request). No suspension enforcement at all (weak security).

## Auth responses use AuthUserDto, never expose raw entity

**Decision:** All `/auth/*` endpoints return `AuthUserDto` — a carefully-chosen subset: `{ id, email, displayName, emailVerified, accountStatus, googleLinked, roles, did }`. The `googleId` is never exposed; only `googleLinked` (boolean) is returned. Raw `User` entity is never spread into response payloads.
**Why:** An earlier regression leaked `passwordHash` and `appwriteUserId` in the Appwrite login response. Explicit DTO mapping prevents accidental field leaks. A test asserts the response has only the whitelist keys.
**Alternatives considered:** Spreading the entity with a blacklist (fragile, easy to forget sensitive fields as new ones are added).

## Mobile session storage: tokens in SecureStore, user snapshot in AsyncStorage

**Decision:** `frontmobile/` stores auth tokens (`accessToken`, `refreshToken`) in SecureStore with policy `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (encrypted on-disk, accessible only when device is unlocked). The user snapshot (`{ id, email, displayName, emailVerified, roles, did }`) is stored in AsyncStorage (persistent, unencrypted, < 2048 bytes). Bearer token is attached only to `API_BASE_URL` requests. On 401, a single-flight refresh attempt is made (compare-and-set on refresh token, safe for race conditions); 401/403 on refresh is terminal and logs the user out. Network errors on refresh keep the session (optimistic).
**Why:** SecureStore protects the refresh token on disk (re-authentication vector if stolen). AsyncStorage is fast, non-encrypted read for the UI snapshot (no need to decrypt on every render). Single-flight refresh prevents token storms on concurrent 401s. Bearer scoping to API_BASE_URL prevents accidental leaks to third-party APIs.
**Alternatives considered:** All tokens in AsyncStorage (unencrypted disk exposure). No refresh retry (worse UX on transient network errors). Broadcast refresh across tabs (not applicable in mobile context).

## OPEN: who pays for Bitcoin anchoring of certificate events, and the scope of a Merkle batch

**Status:** open — to be decided by the team. Nothing is implemented: `CertificateAnchorService`
still simulates anchoring, and neither `certificate_events` nor `anchor_batches` exists yet (see
`docs/CERTIFICATE_EVENT_CHAIN.md` and `docs/MERKLE_TREE_EXPLAINED.md`).
**Decision (leaning, not final):** for the hackathon, one global batch run by DioteKo on Bitcoin testnet
(no real fees, one wallet, simplest demo). In production the administration funds anchoring from the
fees it collects on issuance, through a per-organization anchoring budget fed by payments. The anchoring
itself stays batched (one Bitcoin transaction per batch); a payment must never trigger its own transaction,
which would defeat the point of the Merkle tree.
**Why:** `ISSUED` and `REISSUED` come with a citizen payment, so the administration earns something per
event and can bear the share of the anchoring cost. `REVOKED` is triggered by the issuer and has no
citizen payment, so the issuer must absorb its cost, and a revocation must never be blocked for lack of
anchoring budget. One transaction costs about the same for 4 or 1 000 events, so the cost per event falls as
the batch grows.
**Alternatives considered:** (1) one global batch, fees split between organizations pro rata (needs
per-organization accounting); (2) one batch per organization (each pays and signs its own anchoring and it
fits `organization_id`, but a small organization fills a batch slowly: longer delay or higher cost per
event). Option (2) is the long-term evolution of the leaning above.
**Open points:** batch close rule (every N minutes or every M events); where the anchoring share is
withheld (the Bitnob payout to the administration is the natural place, not verified in the code); whether
the real anchoring uses a self-built `OP_RETURN` transaction or an existing grouped service
(OpenTimestamps, to verify before adoption).

## DioteKo runs its own Postgres, network and host port

**Decision:** The root dev stack (`docker-compose.dev.yml`) owns its database: a `postgres` service
(container `dioteko-postgres`, `postgres:18-alpine`, named volume `postgres_data`) on the project's own default
network, published on host port **5435** (`DIOTEKO_PG_HOST_PORT` in `.env.dev`). `dioteko_dev_bitnob` is created by
`POSTGRES_DB`; `dioteko_test_bitnob` is created idempotently by `scripts/docker-dev-up.js` (`npm run dev:up` / `db:setup` /
`db:reset`) with `psql` inside the container.
**Why:** The repo is shared. A self-contained stack works on any machine with Docker and cannot disturb (or be
disturbed by) other projects. Port 5435 avoids 5432/5433/5434, which other projects commonly publish.
**Alternatives considered:** Reuse a shared container when present (rejected: machine-specific behaviour); a `db-init`
service pointed at the container (rejected: one more moving part, and `POSTGRES_DB` plus a script cover both
databases); an init SQL file in `/docker-entrypoint-initdb.d` (rejected: it only runs on an empty volume, so it would
not repair an existing one).
**Consequences:** Host-run tools must use the port: `DB_PORT` and `DATABASE_URL` in `backend-nest/.env` and
`.env.test` (templates updated). `docker-compose.prod.yml` is still a byte copy of the dev file, so it carries the same
Postgres service; a real production compose is separate work.

## Bitnob Lightning pay-in: webhook as a signal, Bitnob read as the authority

**Decision:** Citizens pay certificate requests through Bitnob Lightning. A Bitnob
webhook is only a **signal**: the backend finds the matching invoice (`data.id`, `data.invoice_id`, `data.payment_hash`, then the BOLT11 `data.invoice`),
then **reads the invoice from Bitnob** and marks it paid only if Bitnob says `paid` with the same amount, payment hash and
invoice id (`BitnobInvoiceSettlementService`, the single place an invoice becomes paid). The status route and `issue` use the
same read as a fallback, so a lost webhook cannot strand a paid request. Invoices are created WITHOUT a Bitnob customer
(optional at Bitnob). The request is claimed atomically (`accepted` to `awaiting_payment`) before any provider call, and an expired invoice reopens the request (back to `accepted`) with a new
idempotency key (`dkinv_<requestId>`, then `dkinv_<requestId>_<n>`; the key is built from the request id).
**Why:** Bitnob documents the webhook envelope but not the name of the "invoice paid" event, and a webhook payload is
attacker-influenced; reading the invoice back is the same rule already used for payouts ("reconcile is authority") and
makes forged or replayed deliveries harmless. Bitnob itself recommends querying in case webhooks fail. The atomic claim
and the reuse of an unlinked open invoice stop two invoices for one request (a payer could otherwise pay the one the request
does not point at).
**Alternatives considered:** Branching on a guessed event name (rejected: unknown, and still needs a read); trusting the
webhook payload (rejected: forgeable if the secret leaks, and mislabelling risk); one Bitnob customer for DioteKo (rejected:
`customer_id` is optional).
**Consequences:** No way to settle a sandbox Lightning invoice through the API (sending is disabled), so an end-to-end
payment needs a real wallet. Remaining gaps are listed in `docs/KNOWN_ISSUES.md`.

## Identity is Appwrite + Google only; the holder's name is declarative

**Decision:**
1. Identity = Appwrite + Google only.
2. The holder's name is **declarative**: the holder provides it and the server does not verify it.
   Decision D3 (how the name is sourced and shown) stays **open**.

**Why:** The citizen app and the staff console both call `backend-nest` only, and Bitnob is the single payment rail
for the hackathon. Because the name is declarative, no identity-proofing provider is needed in the login path.

**Alternatives considered:** keeping an identity-proofing provider in the login path for a later step — not retained,
because the name is declarative.

**Open:** D3 (source and display of the holder name). For residence and identity certificates, the holder gate is the
identity check (KYC through Idswyft); see the KYC entries below.

## Idswyft self-hosted chosen as the KYC provider; Ballerine not retained

**Decision:** Identity verification runs on a self-hosted Idswyft (API on port 8000, dashboard on 8087, in its own Docker stack
outside this repo). `backend-nest/src/modules/kyc/` calls it with an `X-API-Key`.
**Why:** Document and selfie processing stays on our own infrastructure, with no third-party cloud. Idswyft documents a v2
verification flow (initialize, front, back, live capture, status) and signed webhooks.
**Alternatives considered:** Ballerine (also running locally, ports 3010 and 3011) — not retained: its README says « rebuild, not
supported », it is oriented to business (KYB) rather than individuals, and it ships no mobile SDK. Idswyft Cloud — not used with
real data until its data region is known and the CDP authorisation is given.

## KYC scope: residence and identity required; birth, marriage and death planned

**Decision:** Each certificate type carries a `kyc` policy. `residence` and `identity` are `required` (blocking). `birth`, `marriage`
and `death` are `planned`: the target is mandatory, but they do not block until listed in `KYC_ENFORCED_TYPES`, or until their value
becomes `required` in the catalog.
**Why:** The identity document proves who asks, not the data of the act. Parents' names are not on the ID, so they stay declared by
the holder and go through the `needs_info` flow. The rollout is staged so the server and the app are ready without a rewrite.
**Alternatives considered:** Blocking all five types now — rejected: the parents' names cannot be verified this way, and support
for Senegalese documents is untested. No gate at all — rejected: residence and identity certificates would be issued to unverified
holders.

## The Idswyft webhook is a signal; `verified` is read back from the provider and write-once

**Decision:** A webhook only triggers a re-read of `GET /api/v2/verify/:id/status`. A dossier becomes `verified` only when that read
answers `final_result: verified` for the same verification id. A `verified` row is never updated again (the write is conditional on
the dossier still being open).
**Why:** A signed body can still be replayed or be wrong; the provider's read is the proof, the same rule as for Bitnob. Write-once
protects the record that later gates rely on.
**Alternatives considered:** Trusting the webhook payload — rejected (no timestamp in the signature, replay surface). Latest status
wins — rejected: a later failure would revoke a past verification, while the gate only asks whether any dossier is `verified`.

## KYC gate before the invoice, not at issuance of a paid request

**Decision:** `KYC_REQUIRED` is checked when a request is filed, resubmitted, or when a Lightning invoice is created, before any
payment claim. It is not checked when an already paid request is issued.
**Why:** No money moves without a verified holder. A holder who has already paid must not be stranded by a later change of dossier
(expiry, failed re-read).
**Alternatives considered:** Re-checking at issuance of paid requests — rejected: it strands paid holders. The check is kept only in
the free-type path (`startIssuance` from `accepted`), where no payment step exists.

## Provider failure reasons mapped to a fixed enum

**Decision:** The provider's free-text failure reason is mapped to `document_unreadable | document_expired | selfie_mismatch |
liveness_failed | rejected | other` (`classifyFailureReason`). Only this value is stored and shown. Provider response bodies are never
echoed; only Idswyft's short error code is kept for logs.
**Why:** Provider text can repeat what was read on a document (names, numbers). The enum keeps the database, the logs and the
screen free of document content, and gives the app one fixed message per reason.
**Alternatives considered:** Storing the provider text — rejected (personal data in a table and in logs).

## Relecture KYC par un agent, avec copies chiffrées des pièces

**Decision:** Quand le contrôle automatique échoue (MRZ illisible, rejet ou panne d'Idswyft), un flag envoie le dossier à un agent de la console (`manual_review`, colonne `review_origin`). Pour qu'il ait quelque chose à regarder, les photos sont gardées chiffrées (AES-256-GCM, clé `KYC_DOC_ENCRYPTION_KEY`) dans `kyc_documents`, uniquement quand un flag le demande, supprimées à la décision ou à l'expiration.
**Why:** Le MRZ de la CNI sénégalaise ne passe pas de façon fiable (`docs/KYC.md` §12 à §15) et les seuils d'Idswyft sont codés en dur dans l'image. Sans relecture humaine dans DioteKo, un citoyen légitime reste bloqué. C'est une entorse assumée au principe « aucune image en base ».
**Alternatives considered:** Renvoyer l'agent vers le dashboard Idswyft — rejeté (pas de lien avec les rôles DioteKo, et impossible si Idswyft est arrêté). Nouveau statut `pending_agent_review` — rejeté : `manual_review` existe déjà dans l'index unique partiel, le garde d'écriture et l'écran mobile. Autoriser la demande payante pendant la relecture — rejeté : la porte `assertVerifiedFor` reste fermée.
**Garde-fous:** `verified` n'est écrit que par la relecture du prestataire ou par un agent (jamais son propre dossier, toutes les pièces vues, écriture conditionnelle, audit). Un rejet inexpliqué, un selfie non concordant et une pièce expirée restent définitifs même avec le fallback.

## Inscription publique email + mot de passe dans Nest (2026-10-18)

**Decision:** `POST /api/auth/register` crée un citoyen (rôle `holder` uniquement, DID, `emailVerified=false`, `organization_id` null) avec un mot de passe haché (bcrypt), puis renvoie la même session que le login Google. `POST /api/auth/login` sert désormais aux comptes staff **et** aux citoyens inscrits et renvoie aussi `user` (champ additif). L'inscription vit dans Nest, pas dans Appwrite : la configuration Appwrite (Google seul, section « Appwrite is identity-proofing only ») ne change pas.
**Why:** l'écran mobile d'inscription sans Google n'était qu'un formulaire vide (`onSubmit` TODO) ; le besoin est de pouvoir créer un compte sans Google.
**Garde-fous:** corps limité à `email`, `password` (8 caractères mini, 72 octets maxi : limite bcrypt), `displayName` optionnel (le `forbidNonWhitelisted` global refuse `roles`, `organizationId`...) ; 409 neutre si l'email existe (comparaison `lower(trim(email))`) ; faux `bcrypt.compare` au login quand l'email est inconnu ; `login` n'ajoute jamais de rôle ni de DID ; `@nestjs/throttler` sur `register` (5/min/IP), `login` (10/min/IP) et `refresh` (30/min/IP), désactivé quand `NODE_ENV=test`.
**Risque accepté (pas d'SMTP, donc pas de vérification d'email) :** quelqu'un peut inscrire l'email d'une autre personne ; celle-ci recevra alors un 409 en se connectant avec Google. La reprise automatique du compte par Google a été écartée : sans colonne `registration_source`, elle écraserait aussi les comptes staff du seed, et la victime hériterait des données préparées par l'attaquant. **À traiter avant la prod :** vérification d'email (SMTP), flux de récupération de mot de passe, limiteur par email sur `login`, `trust proxy` si l'API est derrière un reverse proxy.
**Alternatives considered:** email/mot de passe via Appwrite (lève la protection anti pré-inscription) ; garder Google seul.
