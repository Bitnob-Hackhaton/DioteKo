# Lessons Learned — DioteKo

Root causes and durable lessons from bugs/incidents, so they don't get rediscovered the hard
way twice. Entries are added after non-trivial fixes, by `@knowledge-curator`. They are listed
from the oldest to the newest, and each one ends with a rule to remember.

Format for new entries:

```
## <short title>

**Problem:** what broke or went wrong, observed symptom.
**Root cause:** the actual underlying reason (not just the symptom).
**Fix:** what changed, files touched.
**Verification:** the test/check that now guards this case.
**Rule to remember:** the one-sentence takeaway for next time.
```

## Appwrite 1.5.4 returns HTTP 500 on every request

**Problem:** `GET http://localhost:8090/` → `{"message":"Server Error","code":500,"file":".../Appwrite/Utopia/Request.php","line":152}`; trace shows `getHeader("x-appwrite-response-format", null)` from `app/controllers/general.php:399`.
**Root cause:** `_APP_SYSTEM_RESPONSE_FORMAT` was not defined in `docker-compose.appwrite.yml`; the unset env resolves to `null`, which `Request::getHeader()` (string-typed default) rejects with a TypeError. The official Appwrite compose always defines it (empty).
**Fix:** added `_APP_SYSTEM_RESPONSE_FORMAT: ""` to the `appwrite` service in `docker-compose.appwrite.yml`; recreated the container (`docker compose -p dioteko-dev-bitnob -f docker-compose.dev.yml up -d --no-deps appwrite`).
**Verification:** `curl -i http://localhost:8090/` → 200; `curl http://localhost:8090/v1/health/version` → `{"version":"1.5.4"}`.
**Rule to remember:** when hand-writing an Appwrite compose, every `_APP_*` var the official `.env` declares must exist (even empty) — an unset one can surface as a 500 TypeError rather than a config error.

## Entity leak: raw User exposed in auth response

**Problem:** `POST /api/auth/appwrite/login` response returned the raw TypeORM `User` entity spread into the result, leaking `passwordHash` and `appwriteUserId`.
**Root cause:** Service returned `{ ...tokens, ...this.user }` without filtering. The controller spread it into the response DTO unchanged.
**Fix:** Created `AuthUserDto` with explicit field mapping (`id`, `email`, `displayName`, `emailVerified`, `accountStatus`, `googleLinked`, `roles`, `did`); all auth endpoints now return this DTO. Service returns it, never the entity. Added test assertion that response keys match the whitelist exactly.
**Verification:** `npm run test` (unit specs for auth service, response shape validator in appwrite-login.e2e-spec.ts); `test/appwrite-login.e2e-spec.ts` (E2E; skipped if `APPWRITE_API_KEY` unset).
**Rule to remember:** services return DTOs, never entities; test the response shape to prevent future leaks.

## Pre-hijack via provider signup

**Problem:** Any identity provider (Appwrite, or a future one) that offers non-OAuth signup methods (email/password, magic link, OTP) can be used by an attacker to pre-register a victim's email before the victim ever tries to log in, pre-hijacking the victim's future login.
**Root cause:** Third-party signup methods trust the email claim without the email owner's involvement. If local code later auto-links accounts by email, the attacker's provider account gains access to the victim's local account.
**Fix:** `APPWRITE_REQUIRE_GOOGLE_IDENTITY=true` (production default). Appwrite production project disables Email/Password, Anonymous, Magic URL, Email OTP, Phone auth methods — only Google OAuth is enabled. Configuration-level enforcement is more reliable than code gates.
**Verification:** Appwrite console project config; `env.validation.ts` asserts the requirement; `npm run seed:appwrite` creates E2E user only with `APPWRITE_REQUIRE_GOOGLE_IDENTITY !== 'false'`.
**Rule to remember:** disable non-OAuth provider signup methods in the provider config, don't rely on code-level gates alone.

## Shared working tree with parallel git operations

**Problem:** While one agent was editing files, another agent ran `git stash` / `git stash pop` to establish a baseline. No data was lost, but the pattern is risky if stash timing overlaps an in-progress edit.
**Root cause:** Agents in the same conversation share the filesystem and can issue git commands that affect the whole working tree without coordination.
**Fix:** Document the rule: never `git stash`, `git checkout`, `git reset`, or `git clean` in a shared tree. Compare baselines by filtering output or copying the tree if a clean baseline is needed.
**Verification:** Code review of agent handoffs; conversation history shows no lost work.
**Rule to remember:** in a multi-agent session on one working tree, avoid git commands that affect the whole tree; use filtering or copies instead.

## node-appwrite SDK compatibility range unverified

**Problem:** `node-appwrite@28` (used in `AppwriteService`) targets Appwrite server 1.9.x per its README, while the local server is pinned to 1.5.4 (`docker-compose.appwrite.yml`) — outside the official compatibility range.
**Root cause:** The Appwrite 1.5.4 server was already in place; the SDK is newer than the server.
**Fix:** None needed in code. Checked on paper only: the 1.5.4 source and generated specs show `GET /account`, `POST /account/jwt`, `GET /account/identities` (JWT auth, scope `account`), `GET /users/identities` and `PATCH /users/:id/verification` with the same paths; the SDK omits the `total` param when undefined. **No live call against the running container has been made yet** (backend unit tests mock the SDK).
**Verification:** Still to do: once `APPWRITE_API_KEY` is set, run `npm run seed:appwrite` and `npm run test:e2e` (Appwrite spec), then a real Google login on a device, and confirm `google_id` is filled in `users`.
**Rule to remember:** when a library is outside its documented compatibility range, smoke-test the exact calls against the live server before relying on them; reading specs is not a substitute.

## Appwrite users created via Users API have emailVerification=false

**Problem:** `AppwriteService.seed()` created Appwrite users for E2E tests via the Users API endpoint (`users.create()`). These users had `emailVerification=false`, which the login gate rejected (enforces `emailVerification=true` before minting tokens).
**Root cause:** The Users API endpoint does not auto-verify email; only OAuth flows (or an explicit `users.updateEmailVerification()` call) set the flag to true.
**Fix:** Added `await users.updateEmailVerification(userId, true)` after creating each seed user in the Appwrite service.
**Verification:** `npm run seed:appwrite`; `curl http://localhost:8090/v1/users/<userId>` confirms `emailVerification: true`; `npm run test:e2e` (appwrite-login spec) passes.
**Rule to remember:** when seeding Appwrite users via the Users API for E2E tests, explicitly call `updateEmailVerification()` if the test expects verified users.

## Google login via self-hosted Appwrite: wrong redirect URL, no tunnel

**Problem:** Tapping "Sign in with Google" in Expo Go on a phone opened the browser, then the app logged `browser auth result {"type":"cancel"}` / `Connexion Google annulee`. Adding `exp://192.168.1.69:8083` in Google Cloud failed with "must end with a public top-level domain".
**Root cause:** Two different redirect URLs were mixed up, and the local setup could not produce a valid one. (1) The app's deep link (`exp://…` in Expo Go, `dioteko://auth/google/callback` in a dev build) is sent to Appwrite as `success`/`failure`; it is NOT a Google redirect URI. Google only needs Appwrite's callback `https://<appwrite-host>/v1/account/sessions/oauth2/callback/google/<PROJECT_ID>`. (2) Appwrite builds that callback from the request host name and drops the port (measured: `http://localhost/v1/…` from `localhost:8090`, `http://192.168.x.x/v1/…` from a LAN IP — Google rejects IPs). (3) `EXPO_PUBLIC_APPWRITE_ENDPOINT=http://localhost:8090/v1` points a physical phone at itself, so the browser never reached Appwrite.
**Fix:** HTTPS tunnel to Appwrite (`ngrok http 8090` → free static domain), that tunnel's callback registered as the only Google redirect URI, `EXPO_PUBLIC_APPWRITE_ENDPOINT=https://<tunnel>/v1`, Expo restarted with `--clear` (EXPO_PUBLIC_* are inlined at bundle time). No code change. Docs: DEV_WORKFLOW "Testing Google login from a phone or emulator".
**Verification:** `curl` against the tunnel: `/v1/health/version` → 1.5.4 and `/v1/account/tokens/oauth2/google?...` → 301 to Google with `redirect_uri=https://<tunnel>/v1/account/sessions/oauth2/callback/google/<id>`; real login confirmed by the user on the phone.
**Rule to remember:** before debugging the app, `curl` the Appwrite OAuth start URL with the same `success` URL and read the `redirect_uri` in the `Location` header — that is exactly what Google must have. On a phone, never use `localhost` or a LAN IP for Appwrite; use an HTTPS tunnel.

## Mobile app would not bundle: dependencies had drifted past Expo SDK 57

**Problem:** `npx expo start` failed one error at a time: "NativeWind only supports Tailwind CSS v3" → `Unable to resolve react-native-css-interop/jsx-runtime` → "expo-router is no longer compatible with react-navigation" → `react-native-svg` importing `buffer` → `Cannot find module react-native/rn-get-polyfills`. `pnpm lint` crashed (`getFilename is not a function`) and `tsc` showed 493 errors.
**Root cause:** The dependency set went beyond what Expo SDK 57 supports: react-native 0.87 (SDK 57 pins 0.86.x), TypeScript 7 (SDK: ~6.0), ESLint 10 (eslint-plugin-react/import only support ≤ 9), gesture-handler 3, async-storage 3, webview 14, plus `tailwindcss` 4 with NativeWind 4 (which needs Tailwind 3). pnpm's strict `node_modules` also hid `react-native-css-interop` from the app, and `react-native-svg` was only a transitive dependency.
**Fix:** `expo install --fix` (SDK 57.0.26 set); Tailwind 4 requested by the user → NativeWind `5.0.0-rc.0` + `react-native-css`, `@tailwindcss/postcss`, `lightningcss` pinned 1.30.1 (override in `pnpm-workspace.yaml`), `tailwind.config.js` replaced by `@theme` in `app/global.css`, `postcss.config.mjs` added; theme/tab imports moved off `@react-navigation/*` (`expo-router`, `expo-router/react-navigation`); `react-native-svg` 15.15.4 as a direct dependency; ESLint pinned to 9.
**Verification:** iOS and Android bundles return HTTP 200 (`/node_modules/expo-router/entry.bundle?platform=…`, ~2400 modules) with the generated Tailwind styles in the bundle; `npx expo install --check` reports nothing; `pnpm lint` runs; `tsc --noEmit` 44 errors (pre-existing). Not run on a device.
**Rule to remember:** after ANY dependency change in `frontmobile`, run `npx expo install --check` and keep Expo-managed packages on the SDK's versions (`bundledNativeModules.json`); treat "latest" as wrong for react-native, typescript, gesture-handler, async-storage and webview. A real bundle request is the acceptance test — typecheck alone misses these. Rebuild the dev build after native dependency changes.

## Google login: `AppwriteException: The requested route was not found` (SDK 0.34 vs Appwrite 1.5.4)

**Problem:** After the Google OAuth redirect, login failed with `AppwriteException: The requested route was not found`. It showed only in the LogBox (`social-connections.tsx` `console.error`), nothing in the Expo "api" logs; the error toast was also a different (white/red) style from the success toast.
**Root cause:** `react-native-appwrite@0.34.0` `account.createJWT()` calls `POST /account/jwts` (Appwrite ≥ 1.6); the local server is 1.5.4, which only has `POST /account/jwt` (measured: `/account/jwts` → 404 `general_route_not_found`, `/account/jwt` → 401). The Appwrite SDK uses its own `fetch`, so the axios interceptor in `services/api.ts` never sees these calls, and the catch in `signInWithGoogle` only handled `AxiosError`. The error toast fell back to the library default because `toastConfig` (`app/_layout.tsx`) only defined `success`.
**Fix:** `services/appwriteAuth.ts`: `createAppwriteJwt()` retries on `/account/jwt` via `client.call` when the 404 `general_route_not_found` occurs (remove once the server is ≥ 1.6); `AppwriteException` is logged as `{ code, type }` and mapped to a friendly message. `app/_layout.tsx`: shared `PillToast` for `success`/`error`/`info`; `components/ui/icon-symbol.tsx`: `xmark.circle.fill`, `info.circle.fill`.
**Verification:** `curl -X POST localhost:8090/v1/account/jwt` → 401 (route exists); `tsc --noEmit` adds no error in touched files. Real login on device to be confirmed by the user.
**Rule to remember:** check SDK ↔ Appwrite server version compatibility (SDK route changes are silent until called); Appwrite SDK calls bypass the axios interceptor, so log them explicitly in `appwriteAuth.ts`.

## Google login: `ERR_NETWORK` to the backend although it was healthy

**Problem:** After the Appwrite session + JWT succeeded, `POST /auth/appwrite/login` failed with axios `ERR_NETWORK` (`apiBaseUrl: http://localhost:3003/api`), toast "Serveur indisponible… Verifie que le backend est demarre".
**Root cause:** `frontmobile/.env` had `EXPO_PUBLIC_API_BASE_URL=http://localhost:3003/api`, which overrides the LAN-IP auto-detection in `config/config.ts`; on a physical phone `localhost` is the phone itself. The backend was fine: container healthy, `GET /api/health` → 200, `POST /api/auth/appwrite/login` with a fake JWT → 401 on both `localhost` and the LAN IP. `DEV_WORKFLOW.md` listed `localhost` as the example value.
**Fix:** removed the override from the local `.env` (auto-derives `http://<LAN-IP>:3003/api`); dev-only `console.warn` in `config.ts` when `API_BASE_URL` is localhost on native; dev error message now names the target URL; `.env.exemple` and `DEV_WORKFLOW.md` corrected.
**Verification:** `curl` health/login via localhost and LAN IP (200/401); `tsc --noEmit` clean for touched files. Phone-side login to be confirmed (Windows firewall must allow inbound 3003).
**Rule to remember:** on a physical device never use `localhost` — Appwrite goes through an HTTPS tunnel, the API through the PC's LAN IP (or no override). Check the `apiBaseUrl` in the log before suspecting the backend.

## Bitnob Lightning settlement: documented simulation route returns 405

**Problem:** `docs/BITNOB.md` claimed that `POST /api/payouts/simulate-address-deposit` simulates a Lightning invoice settlement in sandbox. Tested: the route returned `405 Method Not Allowed`; other guessed paths (`/api/lightning/simulate`, `/api/lightning/invoices/:id/simulate`) returned 404. No sandbox method to mark a Lightning invoice paid is confirmed.
**Root cause:** The official Bitnob docs mention the simulation route but do not clarify its scope (it appears to be for fiat on-chain payouts, not Lightning); the Bitnob sandbox for this account may have the feature disabled or never had it enabled. No test was done against the live sandbox before the implementation.
**Fix:** Documented the 405 result and the gap in `docs/BITNOB.md` and `KNOWN_ISSUES.md`; noted that settlement requires either a real Lightning wallet or clarification from Bitnob. Added `BitnobInvoiceReconcilerService` so webhook is not the only path to settlement (reads pending invoices periodically and settles on status change).
**Verification:** Code compiled and tested offline (298 specs, `tsc` clean). Live settlement still requires a real wallet or Bitnob's answer. The reconciler was tested in unit specs (mocked Bitnob reads).
**Rule to remember:** never trust a single vendor doc route without testing it against the actual API, especially when it touches money. Verify every simulation/sandbox path on day 1, not at the last moment. Have a fallback path (here: reconciler polling) if the primary one (webhook) is fragile or unverified.

## Webhook event dispatch by prefix can silently absorb events

**Problem:** A Bitnob `transfer.*` webhook arriving for a Lightning invoice payment would previously be ignored (the `dispatchTransferEvent` handler assumed `transfer.success` = withdrawal completion only). If a later webhook arrived with the same `event_id`, it would be skipped as duplicate. The event ends up persisted with no action taken.
**Root cause:** Event dispatch was hardcoded to one path (withdrawals); no fallback to check whether the event belonged to a different entity type (Lightning invoices). Webhook fixes were only tested as unit specs; end-to-end webhook tests were impossible without a sandbox method to trigger payment.
**Fix:** Added `dispatchLightningInvoiceSignal` path: if `transfer.*` does not match a withdrawal, try extracting a Lightning invoice reference (`data.id`, `data.invoice_id`, `data.payment_hash`, or `data.invoice` = BOLT11) and signal settlement. The `dkinv_` prefix is only the idempotency key sent at creation; the webhook never matches on `reference`. The webhook still never marks paid; `settleIfPaid` does (which re-reads Bitnob first).
**Verification:** Unit tests updated (invoice/withdrawal isolation, duplicate event handling); 298 specs pass. End-to-end webhook dispatch still unverified (blocked by sandbox settlement method gap).
**Rule to remember:** when routing events by prefix, always have a test that verifies the full path (from wire event through to the final state change). A unit test that mocks the read is not enough; test the dispatch decision in isolation and ensure no event can be silently absorbed by the wrong handler. Use event names and stateful tracking (not just prefixes) to disambiguate; log what was attempted if an event does not match any expected type.

## Mobile: `Cannot GET /api/admin-certificates/requests` (404) alors que le code est juste

**Problem:** Après l'ajout des routes de liste, l'application reçoit `Cannot GET /api/admin-certificates/requests` (404). Le source contient bien la route.
**Root cause:** Le conteneur `backend-nest` n'a ni volume de code ni `watch` : il exécute l'image construite au dernier `npm run dev:up`. Cette image était antérieure aux routes.
**Fix:** Reconstruction de l'image avec `npm run dev:up` (pas de correctif de code). Procédure ajoutée dans `docs/DEV_WORKFLOW.md`.
**Verification:** `curl -si http://localhost:3003/api/admin-certificates/requests` répond `401` (route présente, protégée par JWT) et non plus `404`.
**Rule to remember:** après tout changement de route ou de code de `backend-nest`, relancer `npm run dev:up`. Un `404` sur une route qui existe dans le source signifie image périmée, pas bug de routage ; vérifier d'abord avec `curl` (401 attendu).

## Mobile: écran de scan QR noir (`StyleSheet.absoluteFillObject` retiré)

**Problem:** L'écran de vérification par QR (`frontmobile/app/(tabs)/VerificationScreen.tsx`) reste noir : le `CameraView` d'`expo-camera` n'a aucune taille.
**Root cause:** React Native 0.86 a retiré `StyleSheet.absoluteFillObject`. La propriété vaut `undefined` à l'exécution, donc le style passé à la caméra est vide. Aucune erreur n'est levée.
**Fix:** Remplacement par `StyleSheet.absoluteFill` dans `VerificationScreen.tsx`. Ajout du plugin `expo-camera` dans `frontmobile/app.json` (chaîne de permission iOS).
**Verification:** Scan QR affiché sur le téléphone.
**Rule to remember:** après une montée de version de React Native, rechercher les API retirées (`grep -rn absoluteFillObject frontmobile`) et vérifier l'écran sur appareil : un `undefined` à l'exécution ne produit pas d'erreur visible, seulement un écran vide.
