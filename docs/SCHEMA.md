# Schema — DioteKo (TypeORM / PostgreSQL)

For the ER and class diagrams and the links between tables, see [DATABASE_MODEL.md](DATABASE_MODEL.md).

## backend-nest/ (TypeORM / PostgreSQL)

Source of truth: entity files in `backend-nest/src/modules/*/entities/*.entity.ts` and migrations in `backend-nest/src/database/migrations/`. Base class `BaseEntity` adds `id` (uuid PK), `created_at`, and `updated_at` (both timestamptz) — see `docs/IMPLEMENTATION_NOTES.md` for mechanics. Not all entities extend it (append-only rows like `AccessLog` and `AdminCertificateRef`, or join tables like `Role`/`UserRole` have no timestamps).

### Identity & Access Control (`identity` module)

#### `User`
Extends `BaseEntity`. A person who can hold DIDs, issue certificates, verify VCs, or administer the system.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `email` | varchar | nullable, unique; email+password login |
| `phone` | varchar | nullable, unique |
| `passwordHash` | varchar | nullable; bcryptjs hash, only for email+password users |
| `displayName` | varchar | nullable |
| `appwriteUserId` | varchar | nullable, unique; Appwrite OAuth claim |
| `organizationId` | uuid | nullable FK → `Organization`; links staff/issuer users to their institution |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |
| **Relations** | | `organization` (ManyToOne, SET NULL); `sessions` (OneToMany); `userRoles` (OneToMany); inverse rels on `Did`, `AdminCertificateRequest`, `Consent`, etc. |

#### `Organization`
Extends `BaseEntity`. An issuing/verifying institution (hospital, municipality, bank, university, ministry, NGO, merchant).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `name` | varchar | institution name |
| `type` | varchar | `OrganizationType` enum: HOSPITAL, MUNICIPALITY, BANK, UNIVERSITY, MINISTRY, NGO, MERCHANT |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |
| **Relations** | | Inverse: `users`, `adminCertificateRequests`, `adminCertificateRefs`, `dids`, `payments`, `bitnobClients`, `bitnobCards`, `bitnobTrades`, `bitnobPayouts`, `consents`, `accessLogs`, etc. |

#### `Role`
Does **NOT** extend `BaseEntity` (no timestamps). Static role catalog (seeded once). Holds `holder`, `issuer`, `verifier`, `admin`.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `code` | varchar | unique; `RoleCode` enum: HOLDER, ISSUER, VERIFIER, ADMIN |

#### `UserRole`
Does **NOT** extend `BaseEntity` (join table, no timestamps). Links users to roles.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `userId` | uuid | FK → `User` (CASCADE) |
| `roleId` | uuid | FK → `Role` (CASCADE) |
| **Unique constraint** | | (userId, roleId) — no duplicate role grants |
| **Relations** | | `user` (ManyToOne), `role` (ManyToOne) |

#### `Session`
Does **NOT** extend `BaseEntity` (only `createdAt`, no `updatedAt`). One row per issued refresh token.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `userId` | uuid | FK → `User` (CASCADE) |
| `refreshTokenHash` | varchar | bcryptjs hash of the secret half; token format is `${id}.${secret}` |
| `userAgent` | varchar | nullable; user agent from login request |
| `ip` | varchar | nullable; IP address from login request |
| `expiresAt` | timestamptz | token expiry deadline |
| `revokedAt` | timestamptz | nullable; set on logout or rotation (never deleted, only revoked) |
| `createdAt` | timestamptz | session created timestamp |
| **Relations** | | `user` (ManyToOne) |

### DID & Verifiable Credentials (`did-vc` module)

#### `Did`
Extends `BaseEntity`. A minimal, app-local Decentralized Identifier (custom `did:dioteko:<uuid>` method, **not** W3C-registered). No real DID resolution or cryptographic key material.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `did` | varchar | unique; placeholder format `did:dioteko:<uuid>` |
| `controllerUserId` | uuid | nullable FK → `User` (SET NULL); DID controlled by a holder |
| `controllerOrganizationId` | uuid | nullable FK → `Organization` (SET NULL); DID controlled by an institution |
| `document` | jsonb | stub DID Document shape: `{id, controller, created}`; minimal, not W3C-compliant |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |
| **Invariant** | | Exactly one of `controllerUserId`/`controllerOrganizationId` is set (enforced at service layer, not DB) |
| **Relations** | | `controllerUser`, `controllerOrganization` (both ManyToOne, SET NULL); inverse rels on `VerifiableCredential`, `AdminCertificateRef`, `BitnobCard`, `BitnobTrade`, `BitnobPayout`, `Consent`, `AccessLog`, domain `*RecordRef` tables |

#### `VerifiableCredential`
Extends `BaseEntity`. A W3C-VC-shaped credential, signed as a compact JWT (HS256, shared secret).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `type` | varchar | VC type string (e.g., `AdminCertificate`, domain-specific types) |
| `issuerDidId` | uuid | FK → `Did` (RESTRICT); issuer's DID |
| `subjectDidId` | uuid | FK → `Did` (RESTRICT); subject's DID (credential holder) |
| `jwt` | text | Signed JWT string (HS256) |
| `hash` | varchar | SHA-256 fingerprint of signed payload (tampering detection) |
| `status` | varchar | `VerifiableCredentialStatus` enum: ACTIVE (default), REVOKED, EXPIRED |
| `issuedAt` | timestamptz | credential issuance timestamp |
| `expiresAt` | timestamptz | nullable; credential expiry (also encoded in JWT `exp` claim) |
| `metadata` | jsonb | nullable; free-form application metadata |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |
| **Relations** | | `issuerDid`, `subjectDid` (ManyToOne); inverse rels on `AdminCertificateRef`, domain `*RecordRef` tables |

#### `VerifiablePresentation`
Does **NOT** extend `BaseEntity` (only `createdAt`, no `updatedAt`). A holder DID bundling a set of VCs for disclosure to a verifier.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `holderDidId` | uuid | FK → `Did` (RESTRICT); holder's DID |
| `verifierOrganizationId` | uuid | nullable FK → `Organization` (SET NULL); target verifier org |
| `vpHash` | varchar | Content fingerprint (holder + credential ids + context); integrity/idempotency marker, not a crypto proof |
| `context` | jsonb | Presentation context metadata |
| `credentialIds` | jsonb | Array of VC ids included in this presentation |
| `createdAt` | timestamptz | presentation created timestamp |
| **Relations** | | `holderDid` (ManyToOne), `verifierOrganization` (ManyToOne, nullable) |

### Admin Certificates (`admin-certificates` module)

#### `AdminCertificateRequest`
Extends `BaseEntity`. Intake/payment/issuance workflow row for a holder's request for one admin certificate.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `holderUserId` | uuid | FK → `User` (RESTRICT); the requesting citizen |
| `organizationId` | uuid | FK → `Organization` (RESTRICT); issuing municipality/ministry (resolved at creation time) |
| `certificateType` | varchar | Certificate type (e.g., "birth_certificate", "criminal_record") |
| `submittedData` | jsonb | Form data submitted by citizen |
| `status` | varchar | `AdminCertificateRequestStatus` enum: PENDING (default), AWAITING_PAYMENT, PAID, ISSUED, REJECTED |
| `paymentId` | uuid | nullable FK → `Payment` (SET NULL); link to polymorphic payment ledger |
| `adminCertificateRefId` | uuid | nullable FK → `AdminCertificateRef` (SET NULL); link to issued certificate (null until issuance succeeds) |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |
| **Relations** | | `holderUser`, `organization`, `payment`, `adminCertificateRef` (all ManyToOne) |

#### `AdminCertificateRef`
Does **NOT** extend `BaseEntity` (append-only, only `createdAt`). Stable public reference row for an issued admin certificate.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `subjectDidId` | uuid | FK → `Did` (RESTRICT); subject's DID |
| `organizationId` | uuid | FK → `Organization` (RESTRICT); issuing institution |
| `certificateType` | varchar | Certificate type |
| `externalReference` | varchar | unique; freshly generated UUID (distinct from `id`), used in PDF filenames and public deep-links |
| `vcId` | uuid | FK → `VerifiableCredential` (RESTRICT); the signed credential content |
| `createdAt` | timestamptz | creation timestamp |
| **Relations** | | `subjectDid`, `organization`, `vc` (all ManyToOne) |

### Lightning & Payments (`lightning` module)

#### `LightningInvoice`
Extends `BaseEntity`. One row per BOLT11 Lightning invoice (Bitnob is the provider).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `paymentHash` | varchar | unique; BOLT11 payment hash (public lookup key) |
| `paymentRequest` | text | BOLT11 invoice string |
| `checkingId` | varchar | nullable; left null for Bitnob invoices (the provider's own id is `externalId`) |
| `amountSats` | int | Amount in satoshis |
| `memo` | varchar | nullable; invoice memo |
| `status` | varchar | `LightningInvoiceStatus` enum: PENDING (default), PAID, EXPIRED, FAILED |
| `paidAt` | timestamptz | nullable; timestamp when payment was confirmed |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |

#### `Payment`
Extends `BaseEntity`. Generic, polymorphic payment ledger row for any payment rail (Lightning, Bitnob payouts, Bitnob trades).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `lightningInvoiceId` | uuid | nullable FK → `LightningInvoice` (SET NULL); if payment rail is Lightning |
| `bitnobPayoutId` | uuid | nullable; loose reference to `bitnob_payouts.id` (no DB FK to avoid cycle; integrations/bitnob is kept independent) |
| `bitnobTradeId` | uuid | nullable; loose reference to `bitnob_trades.id` (same reason as above) |
| `purposeType` | varchar | App-level polymorphic type string (e.g., `admin_certificate_request`); no DB FK constraint |
| `purposeId` | uuid | App-level polymorphic id (target row id in the module named by `purposeType`) |
| `amountSats` | int | nullable; amount in satoshis |
| `currency` | varchar | Currency code (default `SATS`) |
| `status` | varchar | `PaymentStatus` enum: PENDING (default), PAID, FAILED, REFUNDED |
| `organizationId` | uuid | nullable FK → `Organization` (SET NULL); organization involved in payment |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |
| **Relations** | | `lightningInvoice`, `organization` (both ManyToOne, nullable) |

### Consent & Access Audit (`consent` module)

#### `Consent`
Extends `BaseEntity`. A holder's consent grant for a verifier to access resources (e.g., "read my AdminCertificate VCs").

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `holderDidId` | uuid | FK → `Did` (RESTRICT); holder's DID |
| `verifierOrganizationId` | uuid | FK → `Organization` (RESTRICT); verifier organization granted access |
| `resourceType` | varchar | Resource type being consented to (e.g., `AdminCertificate`) |
| `scope` | jsonb | Free-form scope bag (e.g., `{fields: ['name','dob']}`); no fixed schema enforced yet |
| `status` | varchar | `ConsentStatus` enum: GRANTED (default), REVOKED |
| `grantedAt` | timestamptz | When consent was granted |
| `revokedAt` | timestamptz | nullable; when consent was revoked |
| `expiresAt` | timestamptz | nullable; optional expiry deadline |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |
| **Relations** | | `holderDid`, `verifierOrganization` (both ManyToOne) |
| **Note** | | Consent records are CRUD-only in this pass; not yet wired into actual verify/issue gates (see `AdminCertificatesService.verifyCertificate`) |

#### `AccessLog`
Does **NOT** extend `BaseEntity` (append-only audit trail, only `createdAt`). Records every action touching a VC/DID resource.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `actorType` | varchar | `AccessLogActorType` enum: VERIFIER_ORGANIZATION, HOLDER, ANONYMOUS, SYSTEM |
| `actorOrganizationId` | uuid | nullable FK → `Organization` (SET NULL); acting organization |
| `actorUserId` | uuid | nullable FK → `User` (SET NULL); acting user |
| `subjectDidId` | uuid | nullable FK → `Did` (SET NULL); DID being accessed |
| `resourceType` | varchar | Resource type (e.g., `VerifiableCredential`, domain-specific types) |
| `resourceId` | uuid | Resource id (e.g., VC id) |
| `action` | varchar | `AccessLogAction` enum: ISSUE, VERIFY, READ, REVOKE |
| `result` | varchar | `AccessLogResult` enum: VALID, INVALID, EXPIRED, ERROR |
| `metadata` | jsonb | nullable; free-form action context (e.g., verification error details) |
| `createdAt` | timestamptz | action timestamp |
| **Relations** | | `actorOrganization`, `actorUser`, `subjectDid` (all ManyToOne, nullable) |

### Bitnob Integrations (`bitnob` module)

#### `BitnobClient`
Extends `BaseEntity`. One row per Bitnob "client"/sub-account tied to an organization.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `organizationId` | uuid | FK → `Organization` (RESTRICT); our organization |
| `companyId` | varchar | nullable; Bitnob company id |
| `clientId` | uuid | Bitnob client/sub-account id |
| `environment` | varchar | Bitnob environment (e.g., `sandbox`, `production`) |
| `name` | varchar | Client name |
| `slug` | varchar | URL-safe slug |
| `orgStatus` | varchar | Organization status per Bitnob (e.g., `active`, `pending`) |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |
| **Relations** | | `organization` (ManyToOne) |
| **Note** | | Not auto-populated yet; write path awaits real Bitnob credentials |

#### `BitnobCard`
Extends `BaseEntity`. One row per issued Bitnob virtual card.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `organizationId` | uuid | FK → `Organization` (RESTRICT); issuing organization |
| `subjectDidId` | uuid | nullable FK → `Did` (SET NULL); cardholder's DID |
| `cardId` | varchar | Bitnob card id |
| `status` | varchar | Plain string (not strict enum); accepts whatever Bitnob webhook sends |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |
| **Relations** | | `organization`, `subjectDid` (both ManyToOne) |

#### `BitnobTrade`
Extends `BaseEntity`. One row per executed Bitnob trade (e.g., BTC/fiat spot).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `organizationId` | uuid | FK → `Organization` (RESTRICT) |
| `subjectDidId` | uuid | nullable FK → `Did` (SET NULL); trader's DID |
| `tradeId` | varchar | Bitnob trade id |
| `baseCurrency` | varchar | Base currency (e.g., `BTC`) |
| `quoteCurrency` | varchar | Quote currency (e.g., `XOF`) |
| `side` | varchar | Trade side (`buy` or `sell`) |
| `quantity` | numeric | Quantity as `numeric`/string (avoids float precision loss) |
| `status` | varchar | Plain string; accepts Bitnob webhook event types |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |
| **Relations** | | `organization`, `subjectDid` (both ManyToOne) |

#### `BitnobPayout`
Extends `BaseEntity`. One row per Bitnob payout (fiat off-ramp: crypto/Lightning → bank account). Tracks the 3-step flow: quote → initialize → finalize (see `docs/BITNOB.md` § "3-Step Payout").

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `organizationId` | uuid | nullable FK → `Organization` (RESTRICT); may be null for raw admin calls |
| `subjectDidId` | uuid | nullable FK → `Did` (SET NULL); payee's DID (from cert-scoped path only) |
| `reference` | varchar | nullable unique; idempotency key = `dkpayout_<id>` (deterministic); Bitnob's only dedup key |
| `adminCertificateRefId` | uuid | nullable FK → `AdminCertificateRef` (RESTRICT); links payout to the certificate it funded |
| `bitnobPayoutId` | varchar | nullable; Bitnob payout uuid (known after quote response) |
| `source` | varchar | nullable; `offchain` or `onchain` (sender type) |
| `fromAsset` | varchar | Source asset (e.g., `BTC`, `USDT`) |
| `toCurrency` | varchar | Target currency (e.g., `NGN`) |
| `amount` | numeric | nullable; payout amount (display units; known after quote) |
| `settlementAmount` | numeric | nullable; settled fiat amount (display units) |
| `status` | varchar | Lowercase status vocab: `quote` (default), `initiated`, `processing`, `completed`, `failed`, `expired` |
| `rawQuote` | jsonb | nullable; full Bitnob quote response (audit trail) |
| `rawResult` | jsonb | nullable; full Bitnob payout record (audit trail, scrubbed PII) |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |
| **Indices** | | Partial unique on `reference` (WHERE ref IS NOT NULL); partial unique on `adminCertificateRefId` (WHERE status NOT IN ('failed','expired')) |
| **Relations** | | `organization`, `subjectDid`, `adminCertificateRef` (all ManyToOne, nullable) |
| **Note** | | Webhook updates are forward-only (rank guard); reconcile-by-polling is authoritative for money decisions |

#### `BitnobWithdrawal`
Extends `BaseEntity` (Increment 4). One row per on-chain crypto withdrawal (`POST /api/withdrawals`).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `organizationId` | uuid | nullable FK → `Organization` (RESTRICT); may be null for raw admin calls |
| `reference` | varchar | nullable unique; idempotency key = `dkwd_<uuid>` (caller-supplied); Bitnob's only dedup key |
| `transactionId` | varchar | nullable; Bitnob transaction uuid (known from response) |
| `toAddress` | varchar | Recipient's on-chain address (validated by Bitnob at create-time) |
| `chain` | varchar | Chain name (lowercase: `ethereum`, `polygon`, `solana`, etc.) |
| `currency` | varchar | Currency (e.g., `USDT`, `USDC`, `BTC`) |
| `amount` | numeric | Base-unit amount (e.g., `"1000000"` = 1 USDT) |
| `status` | varchar | Lowercase status: `pending` (default), `submitted`, `completed`, `failed` |
| `description` | varchar | nullable; off-chain note |
| `txHash` | varchar | nullable; on-chain transaction hash (from `transfer.success` webhook) |
| `networkFee` | numeric | nullable; network/gas fee in base units (from webhook) |
| `rawResult` | jsonb | nullable; full Bitnob response/webhook data (scrubbed PII) |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |
| **Indices** | | Partial unique on `reference` (WHERE ref IS NOT NULL) |
| **Relations** | | `organization` (ManyToOne, nullable) |
| **Note** | | No `subject_did_id` — crypto address is permanent public correlation; webhook updates are forward-only |

#### `BitnobBulkBatch`
Extends `BaseEntity` (Increment 4). One row per bulk-transfer batch (draft → confirm flow).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `organizationId` | uuid | nullable FK → `Organization` (RESTRICT) |
| `idempotencyKey` | varchar | nullable unique; caller-supplied dedup key (distinct from `reference`); Bitnob's batch dedup key |
| `bitnobBatchId` | varchar | nullable; Bitnob batch uuid (known after create) |
| `description` | varchar | nullable; batch-level description |
| `status` | varchar | Lowercase status: `draft` (default), `pending`, `processing`, `completed`, `failed`, `cancelled` |
| `totalItems` | int | nullable; number of items in this batch |
| `totalAmount` | numeric | nullable; sum of item amounts (informational) |
| `successCount` | int | nullable; items completed successfully |
| `failedCount` | int | nullable; items failed |
| `submittedAt` | timestamptz | nullable; when batch was confirmed/submitted |
| `completedAt` | timestamptz | nullable; when batch finished processing |
| `rawResult` | jsonb | nullable; full Bitnob batch record (audit trail) |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |
| **Indices** | | Partial unique on `idempotencyKey` (WHERE key IS NOT NULL) |
| **Relations** | | `organization` (ManyToOne, nullable); inverse `items` (OneToMany) |

#### `BitnobBulkBatchItem`
Extends `BaseEntity` (Increment 4). One row per item in a bulk batch (individual on-chain send).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK (from `BaseEntity`) |
| `batchId` | uuid | FK → `BitnobBulkBatch` (RESTRICT, CASCADE delete not allowed — money record must not be silently wiped) |
| `bitnobItemId` | varchar | nullable; Bitnob item uuid (known after batch create) |
| `rowIndex` | int | nullable; row position in the original batch request (for audit) |
| `chain` | varchar | Chain name (lowercase) |
| `currency` | varchar | Currency (e.g., `USDT`) |
| `address` | varchar | Recipient's on-chain address |
| `amount` | numeric | Base-unit amount (e.g., `"1000000"` = 1 USDT) |
| `description` | varchar | nullable; item-level description |
| `status` | varchar | Lowercase status: `pending`, `processing`, `confirmed` (success), `failed` |
| `failureReason` | varchar | nullable; reason for `failed` status (from Bitnob) |
| `retries` | int | Retry count (default 0) |
| `withdrawalId` | varchar | nullable; Bitnob withdrawal uuid (each item maps to a withdrawal) |
| `rawResult` | jsonb | nullable; full item response (audit trail, scrubbed PII) |
| `createdAt` | timestamptz | (from `BaseEntity`) |
| `updatedAt` | timestamptz | (from `BaseEntity`) |
| **Indices** | | Index on `batchId` (frequent "items of this batch" queries) |
| **Relations** | | `batch` (ManyToOne) |
| **Note** | | Each item is a withdrawal; webhook updates are forward-only; retries must re-poll Bitnob before re-send (M5 blocker) |

#### `BitnobWebhookEvent`
Does **NOT** extend `BaseEntity` (append-only, only `receivedAt` which is `@CreateDateColumn`). Append-only raw log of every Bitnob webhook payload received (Increments 1–5).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `eventId` | varchar | nullable, unique; Bitnob-assigned event id (idempotency guard on retry — Postgres `23505` unique-violation caught → idempotent HTTP 200) |
| `eventType` | varchar | Webhook event type (namespaced: `payouts.initialized`, `transfer.success`, etc.) |
| `payload` | jsonb | Raw webhook payload JSON (persisted before dispatch for audit) |
| `signatureValid` | boolean | Whether `x-bitnob-signature` HMAC-SHA512 verification passed (false if secret unset in dev) |
| `receivedAt` | timestamptz | Webhook receipt timestamp |
| `processed` | boolean | Whether dispatch completed (default `false`) |
| `processingError` | text | nullable; error from dispatch, if any |
| **Note** | | Signature guard runs before handler; forged payloads (invalid sig) return 401 and never create a row |

### Domain Records (Shell Modules)

Seven domain shell modules define `*RecordRef` entities with a unified minimal shape. All are append-only (only `createdAt`, no `updatedAt`) and **do NOT** extend `BaseEntity`. Each mirrors:

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `subjectDidId` | uuid | nullable FK → `Did` (SET NULL); subject's DID |
| `organizationId` | uuid | nullable FK → `Organization` (SET NULL); issuing/verifying org |
| `type` | varchar | Domain-specific type tag (e.g., `diploma`, `employment_contract`) |
| `externalReference` | varchar | nullable; external id or reference |
| `vcId` | uuid | nullable FK → `VerifiableCredential` (SET NULL); linked VC (if issued) |
| `createdAt` | timestamptz | creation timestamp |

Entities (all with identical schema):
- `EducationRecordRef` (table: `education_record_refs`)
- `EmploymentRecordRef` (table: `employment_record_refs`)
- `HealthRecordRef` (table: `health_record_refs`)
- `KycRecordRef` (table: `kyc_record_refs`)
- `MerchantRecordRef` (table: `merchant_record_refs`)
- `SocialAidRecordRef` (table: `social_aid_record_refs`)
- `TransportRecordRef` (table: `transport_record_refs`)

**Note**: Domain-specific columns are TODO in this pass (see entity files' `// TODO:` comments). All `*RecordRef` entities currently hold only the shared minimal fields above.
