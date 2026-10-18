# Known Issues — DioteKo

Real, observed gaps found by direct code inspection (not hypothetical). Each entry: what, where,
why it matters. Update via `@knowledge-curator` as these get fixed or as new ones are found.

## Admin mobile screens are almost entirely mocked

`frontmobile/app/admin/*` (6 screens) exist and render real UI, but nearly every API call
backing them in `frontmobile/services/api.ts` — TPoS terminals, User Manager, Support Tickets,
Bolt Cards, SMTP, Stream Alerts — is a `mockApiCall(...)` stub returning hardcoded fake data
after an artificial delay. There is no real backend for any of this, and the screens are not
linked to the tabs.

## No automated test suite on the mobile app

`frontmobile` has a real lint config (`npx expo lint`) but no test runner.

## backend-nest/

Open items from the code review's final TODO inventory for the NestJS+Postgres backend
at `backend-nest/`. See `backend-nest/README.md` §5 and `docs/DECISIONS.md` for the broader
intentional-simplification context.

### Google identity model and account constraints

- **google_id is link-once:** Set on first Appwrite/Google login, never overwritten. A second login with a different `google_id` returns 403. Relink/merge is deferred (requires admin endpoint).
- **dids.controller_user_id has no unique constraint:** Concurrent first logins can create multiple DIDs for one user. Follow-up: partial unique index on (controller_user_id, status='active') + tolerant createDid.
- **Email uniqueness is case-sensitive at DB level; app-level lookups differ:** Appwrite path normalizes `lower(trim(email))`; login() compares exact email. Follow-up: UNIQUE constraint on `lower(trim(email))` + shared lookup helper.
- **account_status has no DB CHECK constraint:** Suspension is enforced in `AuthService.mintTokens` but not enforced at the database layer (`assertActive` fails closed on any value != 'active').
- **Suspended users keep valid access token up to 15 min:** `JwtStrategy` has no DB read — it decodes JWT only. After suspension, the user's token stays valid until JWT_ACCESS_TTL (15 min). Acceptable window; any future suspend endpoint MUST also call `SessionsService.revokeUserSessions` to revoke immediately.

### API throttling and refresh-token lifecycle

- **No throttling on /auth/login, /auth/appwrite/login, /auth/refresh:** Attack surface for brute-force and denial-of-service. Follow-up: rate limiting by IP or user ID.
- **Refresh-token rotation has no reuse grace:** If the refresh response is lost (network timeout), the next refresh uses an invalidated token and returns 401, forcing re-login. Follow-up: brief grace period (e.g., 30s) to accept the old token one more time.

### Appwrite session cleanup on login failure

- **completeAppwriteLogin leaves an Appwrite session behind on cleanup failure:** If the cleanup (deleteSession call) fails after the user signs in, an orphaned Appwrite session persists. Mobile deletes it on failure with a 5-second timeout (best-effort), but a DB-side cleanup job would be more reliable.

### Bitnob webhook signature verification: residual blockers

`BitnobWebhookSignatureGuard` verifies the `x-bitnob-signature` HMAC-SHA512 over the raw
request body before any handler runs; verified `transfer.*` events drive `bitnob_withdrawals`
status (forward-only). Residual items:

- **Which secret Bitnob signs webhooks with is unconfirmed.** `bitnob.webhookSecret` reads
  `BITNOB_WEBHOOK_SECRET`, falling back to `BITNOB_CLIENT_SECRET`. The two constructions do not
  cross-forge (safe), and a wrong key fails every delivery closed — but resolve this via a live
  sandbox delivery / the Bitnob dashboard before any withdrawal/bulk production-gate lift.
- **`retryItems` re-poll (bulk prod-gate-lift blocker, security-analyst M5).**
  `BitnobBulkTransfersService.retryItems` claims items on the LOCAL `status === 'failed'` with
  no remote re-check. Once a webhook or a stale reconcile can write `failed`, a mismatched
  `transfer.failed` becomes sufficient justification for a double on-chain send. Before the
  bulk production gate is lifted, `retryItems` MUST first `GET /api/bulk-transfers/:id` and only
  re-send items Bitnob also reports failed. (Inert today: bulk is prod-disabled and
  `dispatchTransferEvent` is withdrawals-only per M4 — the `data.transaction_id` ↔
  `bitnob_bulk_batch_items.withdrawal_id` identity is unverified.)
- **`dispatchPayoutEvent` never propagates to `payments.status` (security-analyst S4).** A
  verified `payouts.*` webhook advances `bitnob_payouts.status` but not the linked `payments`
  row — only `AdminCertificatesService.reconcileBitnobPayoutForCertificate` does. Acceptable
  under "reconcile is the authority for money decisions"; the webhook is a latency
  optimisation, not a source of truth. Same applies to `dispatchTransferEvent` and any
  downstream ledger row.
- **`bitnob_webhook_events.payload` is persisted unscrubbed (security-analyst S3).** Payout
  events carry a masked account number per Bitnob's contract, so this is low-risk defense-in-
  depth only. `bitnob_withdrawals.raw_result` written from `transfer.*` IS scrubbed
  (`stripWithdrawalResultPii`).

### Cross-tenant credential revoke not enforced

`src/modules/did-vc/controllers/credentials.controller.ts` (`revoke` handler): any `issuer` or
`admin` can currently revoke ANY organization's credentials, not just their own — there's no
organization-scoping check. Fix requires adding `organizationId` to the JWT payload (currently
just `sub`/`roles`/`did`) and threading it through `AuthService.mintTokens`,
`JwtStrategy.validate`, and `RevocationService.revoke`. Flagged with a `// TODO` in the
controller.

### Périmètre par organisation sur les routes staff

- **Règle :** `issue`, `lightning-invoices`, `lightning-invoices/status`, `bitnob/payouts`,
  `payouts/finalize` et `payouts/reconcile` sont limités à l'organisation de l'acteur, lue **en base**
  (`users.organization_id`, compte actif), jamais dans le JWT ni le client. Une demande ou un certificat d'une autre
  organisation répond **404** (pas 403), avec le même message que pour un id inconnu. Toute route qui écrit un
  certificat ou de l'argent charge la demande avec la portée dans le `WHERE` avant toute autre logique. Code :
  `loadAccessibleRequestOrThrow` et `findOrganizationCertificateRefOrThrow` dans `services/admin-certificates.service.ts`.
- **Limites ouvertes :**
  - `verify` (public) écrit une ligne `access_logs` à chaque appel : amplification d'écriture sans authentification,
    à protéger par du rate-limit (LOW).
  - Le montant d'un versement (`settlementAmount`) est choisi par l'issuer sans plafond lié au paiement reçu (MOYENNE ;
    `finalize` reste réservé à l'admin).
  - Hors module, même risque : `POST did-vc/credentials/:id/revoke` et `bitnob/payouts/*` côté admin global
    (inter-organisations par conception) ne sont pas scopés.
  - Règle admin de plateforme : tout le monde est limité à son organisation ; la route « bris de glace »
    journalisée reste à faire.
  - Pas de test e2e SQL réel sur le filtre `validity` (LOW) : tests unitaires et vérification manuelle par `curl`.
  - `backend-nest` n'a pas de fichier `eslint.config.*` : `eslint` ne peut pas tourner (seul `tsc --noEmit` vérifie).

### Contenu de la demande `submittedData` : liste blanche

- **Mesure en place :** `submittedData` devient le `credentialSubject` tel quel, et les types sans revue sont acceptés sans
  humain. Le serveur ne signe donc que ce qu'il reconnaît : objet simple, clés limitées à `SUBMITTED_DATA_ALLOWED_KEYS`
  (`fullName`, `dateOfBirth`, `placeOfBirth`, `fatherName`, `motherName`, `nationality`, `idNumber`), `fullName` obligatoire,
  valeurs en texte non vide de 200 caractères au plus. Vérifié au dépôt et au renvoi (`assertSubmittedDataValid`). Les valeurs ne sont
  jamais journalisées. Code : `admin-certificates.constants.ts` et `admin-certificates.service.ts`.
- **Limite restante :** la même liste s'applique à **tous les types**. Une liste par type viendra avec le PDF réel (lot 7, C11).
  Le contenu reste déclaré par le titulaire, non vérifié (voir ARCHITECTURE_AS_BUILT §8.3).

### `payments.bitnob_payout_id` / `bitnob_trade_id` have no FK constraint

Plain nullable columns, not real foreign keys. This is a deliberate module-boundary decision,
not a bug — no separate `docs/DECISIONS.md` entry was needed since it's a small, local
data-modeling choice, but it's worth knowing it's intentional before "fixing" it.

### Bitnob API contract verified in sandbox

The Bitnob API contract is verified live against the sandbox environment:
- `GET /api/whoami`, `GET /api/balances/{currency}`, `GET /api/exchange-rates?from=X&to=Y`, `GET /api/transactions` all confirmed.
- `POST /api/payouts/quotes` → `POST .../initialize` → `POST .../finalize` (3-step payout) confirmed. `quote_id` format is `QT2_<digits>`; `settlement_amount` is display units.
- `POST /api/withdrawals` (on-chain crypto) confirmed against the contract; `$10` minimum enforced; same `reference` returns 409 (idempotency working).
- `POST /api/addresses/validate` confirmed; returns `{ valid, address, chain, error? }`.
- Response envelope is `{ success, message, data, timestamp }`; errors follow RFC 7807 + extras.
- HMAC outbound signing: SHA256, headers `X-Auth-{Client,Timestamp,Nonce,Signature}`, payload is compact wire bytes (insertion order).
- Webhook signature: HMAC-SHA512 over raw body (different scheme from outbound), header `x-bitnob-signature`.

**Remaining DOCS-AMBIGUOUS items** (resolution via live ngrok/sandbox delivery needed before prod-gate lift):
- Which secret Bitnob signs webhooks with: `BITNOB_WEBHOOK_SECRET` or `BITNOB_CLIENT_SECRET`? (fallback implemented; needs confirmation from a live delivery.)
- `transfer.failed` webhook body: does it include a failure-reason field? (Not in public docs.)
- Bulk `transfer.*` webhook: does each item receive a separate event, or one bulk event? And is `data.transaction_id` the path to `bitnob_bulk_batch_items.withdrawal_id`? (Bulk writes are 403 in sandbox; unverified.)
- Bulk item `amount` unit: display or base-units? (Chose base-units for consistency; unverifiable in sandbox.)

### Bitnob sandbox limitations

The DioteKo sandbox account has these constraints:
- **Bulk transfers write is disabled**: `POST /api/bulk-transfers` returns 403 "Feature Not Enabled". `GET` works, so request/response shapes are implemented per contract but NOT verified against a live write.
- **No USDT/USDC balance**: `POST /api/withdrawals` for any stablecoin returns 422 "INSUFFICIENT_FUNDS". The `$10` minimum error and 409 dedup could not be observed end-to-end.
- **Payout sandbox does not validate beneficiary at initialize**: an all-zeros account still returns 200 `INITIATED`. Bank rejections surface only at finalize or via polling `GET /api/payouts/:id`.
- Impact: bulk confirms, funded withdrawals and a full withdrawal webhook reconcile cannot be tested. Reconcile-by-polling is the tested path; webhook advances are defended by the forward-only guard and tested in unit specs.

### Bitnob production-gate-lift blockers

Before `BITNOB_ENVIRONMENT=production` can enable real money-moves (currently hard-disabled in all money service methods), these must be resolved:
1. **Webhook secret unconfirmed** — `BITNOB_WEBHOOK_SECRET` vs `BITNOB_CLIENT_SECRET` fallback; resolve via a live sandbox delivery + Bitnob dashboard confirmation.
2. **Raw withdrawal idempotency key missing** — `POST /api/withdrawals` has no content-derived key; a client retry after a network timeout creates a fresh `reference` Bitnob won't dedup (double send). Prerequisite: hash of `to_address+amount+currency+chain`.
3. **Bulk `retryItems` must re-poll before re-send** (security-analyst M5) — currently claims items on local `failed` status with no remote re-check; a webhook or stale reconcile flipping status to `failed` would justify a double on-chain send. Prerequisite: `GET /api/bulk-transfers/:id` and verify Bitnob also reports the item failed.
4. **Bulk item webhook identity unverified** (M4) — `data.transaction_id ↔ bitnob_bulk_batch_items.withdrawal_id` match is a guess; sandbox bulk writes are 403. Prerequisite: live bulk probe in a feature-enabled sandbox.
5. **Payout webhook does not drive `payments.status`** (S4) — `transfer.success` on a payout advances `bitnob_payouts.status` but not the linked `payments` row (only reconcile does). Acceptable under "reconcile is the authority"; noted in IMPLEMENTATION_NOTES.md.
6. **Webhook event payloads not PII-scrubbed** (S3) — `bitnob_webhook_events.payload` persisted raw (payout events carry masked account numbers per contract, low-risk). Prerequisite: optional defense-in-depth scrub.
7. **Webhook secret detection** (S1) — startup WARN when falling back to `BITNOB_CLIENT_SECRET` (no hard blocker, but operational visibility needed).
8. **`bitnob_clients` never auto-populated** — the whoami identity is persisted only on a manual API call. Prerequisite: auto-run on boot or a seeding task.

Blocking all production-gate lifts: **1, 2, 3, 4**. Acceptable pre-prod (do not block): **5, 6, 7, 8**.

### Bitnob rejects calls from a non-allowlisted IP

Every signed Bitnob call (sandbox included) from an IP outside the dashboard allowlist answers 403 `FORBIDDEN`
"IP address not whitelisted". The dev machine works because its IP range was added in the Bitnob dashboard
(a /8 range is used: narrow it to /32 before real credentials). The error comes back if a home IP leaves the range;
production needs a static egress IP. It affects all Bitnob calls, not only the Lightning pay-in. Details:
`docs/BITNOB.md`, section "Lightning pay-in: C0 findings".

### Bitnob Lightning pay-in : points connus

Voir `docs/BITNOB.md`.

- **Réconciliation en arrière-plan.** `BitnobInvoiceReconcilerService` relit les factures `pending` et les règle si elles ont changé de statut chez Bitnob (intervalle configurable, défaut 60 s). Le webhook reste un signal ; c'est la lecture qui paie.
- **Route de simulation Lightning 405.** La documentation mentionne `POST /api/payouts/simulate-address-deposit` pour simuler une facture, mais la route est capturée par `/api/payouts/:id` et retourne 405 ; autres chemins (`/api/lightning/simulate`, `/api/lightning/invoices/:id/simulate`) = 404. La vraie simulation documentée (`/api/payouts/quotes/{quoteId}/deposits`, `source: onchain`) n'a pas été testée.
- **Méthode de règlement sandbox inconnue.** Bitnob désactive `/api/lightning/pay` en sandbox (403 `send_lightning`) ; la doc ne dit pas comment payer/simuler une facture créée par `POST /api/lightning/invoices`. Aucune facture `paid` observée. Le curriculum Code & Chain (atelier Ramane Boda) cite le checkpoint « Facture ln… payée » et les événements `transfer.success`, `deposit.success`, mais la doc API n'en donne pas le payload. À clarifier avec Bitnob.
- **`BITNOB_WEBHOOK_SECRET` retombe sur `BITNOB_CLIENT_SECRET`** quand il est absent : une fuite casserait les deux signatures. À rendre obligatoire et distinct en production.
- **Un événement non signé (chemin de dev sans secret) peut réserver un `event_id`**, ce qui ferait ignorer un vrai événement portant le même id.
- **Les factures de sandbox ont le préfixe `lnbc` (mainnet)** : ne pas payer d'une vraie wallet avant d'avoir confirmé avec Bitnob.

### Appwrite: project/key setup is manual

`npm run dev:up` runs a self-hosted Appwrite locally
(`docker-compose.appwrite.yml`, host port 9000, its own MariaDB + Redis — Appwrite has no
Postgres adapter). Remaining gaps before live end-to-end Appwrite/Google login:
- The project, API key and Google OAuth provider must be created **once via the console** —
  `APPWRITE_PROJECT_ID` / `APPWRITE_API_KEY` in `backend-nest/.env` start empty. Steps:
  `docs/DEV_WORKFLOW.md` → "Appwrite first-run". `npm run seed:appwrite` then creates the E2E
  test user; `test/appwrite-login.e2e-spec.ts` is skipped until `APPWRITE_API_KEY` is set.
- `frontmobile/app.json`'s `ios.bundleIdentifier`/`android.package` (`"com.dioteko.app"`) is a
  guessed value — it must match whatever's registered in the Appwrite console project or the
  client SDK's platform check rejects the app.
- `docs/APPWRITE_ID.md` held a plaintext Appwrite account login (email + password). It was tracked by git (commit `a88ec7c`); it is now untracked and listed in `.gitignore`, but **the password stays readable in the Git history: rotate it** (Appwrite console) and treat it as compromised. Never commit credentials; use `backend-nest/.env`.
- Running `docker-compose up dioteko-backend-nest-bitnob` runs the old image until rebuilt. `.env` must have `APPWRITE_REQUIRE_GOOGLE_IDENTITY` unset or true for real Google login (false only for E2E email/password seed user).

### Mobile SDK / Appwrite server version skew

`react-native-appwrite@0.34` targets Appwrite ≥ 1.6 (`POST /account/jwts`) but the local server is 1.5.4
(`/account/jwt`). `appwriteAuth.ts` `createAppwriteJwt()` falls back to `/account/jwt` on a 404
`general_route_not_found`. Other SDK calls used today (`createSession`, `deleteSession`) exist
in 1.5.4; any new SDK call must be probed against the server. Remove the fallback when
`docker-compose.appwrite.yml` moves to ≥ 1.6.

### Appwrite production hardening checklist

Before moving Appwrite to production, these configuration steps are **mandatory**:
- Disable all auth methods except **Google OAuth**: Email/Password, Anonymous, Magic URL, Email OTP, Phone must all be disabled in the Appwrite console project.
- Reason: a misconfigured provider allows attackers to pre-register victim emails (pre-hijack) before victims attempt to log in.
- Set `APPWRITE_REQUIRE_GOOGLE_IDENTITY=true` (environment var, production default).
- Verify the backend deployment can reach Appwrite at `APPWRITE_ENDPOINT` with valid `APPWRITE_API_KEY`.
- Run `npm run seed:appwrite` to verify the API connection and E2E user setup.

### Vérification d'identité (KYC, Idswyft) : limites ouvertes

Code commité, **jamais exécuté contre une vraie instance Idswyft avec de vraies pièces**. Détail et checklist du spike : `docs/KYC.md` §11 et §12.

- **Sénégal non supporté par Idswyft (documenté) :** le Sénégal n'est pas dans les 19 pays listés ; la CNI sénégalaise n'est documentée nulle part. Impact : une CNI peut être refusée (`document_unreadable`) ou partir en revue. Ne pas promettre le support avant le spike.
- **Spike B0 non fait :** les champs de réponse (`final_result`, `failure_reason`), le code 200 ou 201 des envois, la limite de débit et la signature exacte du webhook sont lus dans le source (tag `v1.12.19`), pas constatés.
- **Webhook non enregistré et impossible en `localhost` :** aucun code DioteKo n'appelle l'enregistrement ; Idswyft refuse une URL privée (SSRF). Seule la relecture `GET /api/kyc/status` fait avancer un dossier en local.
- **Signature à vérifier :** la garde HMAC porte sur les octets bruts. Si Idswyft signe `JSON.stringify(payload)`, les vrais webhooks seront rejetés (401) ; la relecture reste le filet. Vérifier au spike.
- **`manual_review` : décision par un agent DioteKo ou dans le dashboard Idswyft ;** le titulaire voit « En cours d'examen » sans délai.
- **Doublons et réexpiration :** un même document peut vérifier plusieurs comptes (aucune empreinte stockée) ; un dossier `verified` n'expire jamais.
- **Demandes déposées avant le déploiement :** pas de contrôle au dépôt ; la porte n'agit qu'à la création de la facture (et au renvoi).
- **Verrou d'upload en mémoire** (`KycController.uploading`) : protège un seul processus. Avec plusieurs instances, le plafond par session (`attempts`, en base) reste la seule protection.
- **Base et conteneur de dev à mettre à jour par l'utilisateur :** la migration `1789000000000-CreateKycVerifications` est jouée sur `dioteko_test_bitnob` (run, revert, run vérifiés) mais pas sur `dioteko_dev_bitnob`, et l'image `backend-nest` n'est pas reconstruite, tant que l'utilisateur ne le fait pas (`npm run dev:up`).
- **Autorisation CDP et région de données :** à obtenir avant toute production ; pas de Cloud Idswyft avec de vraies données tant que la région n'est pas connue.

### Relecture KYC par un agent : portée plateforme

Voir `docs/KYC.md` §16.

- **La file `/api/kyc/review` n'est pas limitée à une organisation.** Un dossier KYC appartient à la plateforme, pas à une mairie : tout compte `issuer` ou `admin` rattaché à une organisation et actif voit les pièces de tous les titulaires en `manual_review`. Chaque lecture et chaque décision est écrite dans `access_logs`. À trancher avant des données réelles : rôle dédié de relecteur KYC, ou restriction à `admin`.
- **Flags d'assouplissement à resserrer avant la production Bitnob.** `KYC_MRZ_PRECHECK=warn|off` et `KYC_PROVIDER_MODE=manual_only` sont ignorés en production (avertissement au démarrage). `KYC_FALLBACK_MANUAL_REVIEW=on` reste permis : il devient un vrai processus de relecture, qui demande une clé `KYC_DOC_ENCRYPTION_KEY` gardée hors des sauvegardes de la base, une durée de garde décidée, et une autorisation CDP.
- **Pas de rotation de clé.** Une seule clé, sans identifiant de version : la changer rend les copies existantes illisibles (elles expirent, l'agent voit « aucune pièce » et peut seulement rejeter). Ajouter une colonne de version avant toute rotation.
- **Le titulaire n'est pas notifié** de la décision de l'agent : l'écran de l'app se met à jour au prochain sondage du statut.
- **Course à l'envoi.** L'écriture d'une copie est conditionnelle à `pending`, mais un titulaire peut encore remplacer une photo entre la lecture de l'agent et sa décision tant que le dossier est `pending`. L'agent ne voit un dossier qu'en `manual_review`, où aucune copie ne peut plus être écrite.

## frontmobile/

### Baseline `tsc` non modifiée par le KYC

`npx tsc --noEmit` dans `frontmobile/` garde **34 erreurs de thème préexistantes**. Le chantier KYC n'en ajoute pas.

### Google-via-Appwrite login not yet live-testable

`services/appwriteAuth.ts` (Google OAuth via the Appwrite client SDK) is fully wired end-to-end
(`account.createOAuth2Token` → browser redirect → `account.createSession` → `account.createJWT()` →
`POST /api/auth/appwrite/login`), but not yet live-testable — same credential gap as
`backend-nest/`'s Appwrite config above (`app.json` bundle identifiers, `APPWRITE_*` env vars
all still placeholder/unset).

### Google OAuth redirect URI constraints

- **Google rejects IP-based OAuth redirect URIs, and Appwrite drops the port:** measured on the local Appwrite 1.5.4, the callback sent to Google is built from the request host name without the port (`http://localhost/v1/account/sessions/oauth2/callback/google/<id>` from `localhost:8090`, `http://192.168.x.x/v1/…` from a LAN IP). Google refuses IPs, and a phone's `localhost` is the phone. Workaround: an HTTPS tunnel for Appwrite (ngrok / cloudflared) with `https://<tunnel>/v1/account/sessions/oauth2/callback/google/<PROJECT_ID>` as the Google redirect URI and `EXPO_PUBLIC_APPWRITE_ENDPOINT=https://<tunnel>/v1`. The app's own `exp://…` / `dioteko://…` URL must NOT be added to Google (see DEV_WORKFLOW). The `adb reverse tcp:8090` idea does not work (the callback has no port); `adb reverse tcp:80 tcp:8090` is untested and port 80 is already in use locally.

### Not live-tested: real Google OAuth flow on a device

The end-to-end Google/Appwrite login flow has **not been tested on a real device or emulator**, and the mobile app has never been verified on a phone — only static code inspection and backend E2E specs (skipped if APPWRITE_API_KEY unset) have been run. Prerequisites for live testing:
- Dev build (`eas build --platform android` or `--platform ios`).
- Appwrite project created, Google provider configured, API key set.
- Backend container rebuilt with `APPWRITE_REQUIRE_GOOGLE_IDENTITY` set.
- Mobile `app.json` bundle identifiers registered in Appwrite console.

**Also:** `frontmobile/` has no test runner. The toolchain is aligned on Expo SDK 57.0.26 (React Native 0.86.3, TypeScript 6.0.3, ESLint 9.39) and NativeWind 5 RC + Tailwind 4: `pnpm lint` runs (it reports 40 errors / 54 warnings in existing code — 31 `react-hooks/static-components`, 7 `react-hooks/set-state-in-effect`, mostly in components not touched by the Google work) and `tsc --noEmit` reports 44 pre-existing errors. NativeWind 5 is a release candidate (`5.0.0-rc.0`): on-device checks of fonts, shadows, borders and `className`+`style` combos are still pending (see LESSONS_LEARNED).

### No mobile test/simulator verification available in this environment

The mobile app has no test runner or simulator available in this environment — only
`npx expo lint`/typecheck run. Manual verification on a real device/simulator, plus the
Appwrite credentials above, is still needed before this ships.
