# Domain Notes — DioteKo

Glossary and concepts for anyone new to the codebase. Rules live in `docs/BUSINESS_RULES.md`; the
as-built architecture lives in `docs/ARCHITECTURE_AS_BUILT.md`; the data model lives in `docs/DATABASE_MODEL.md`.

## What DioteKo does

Citizens request administrative certificates (birth, marriage, death, residence, identity) from a mobile
wallet app. Some types need an agent of the issuing organization to review the request before payment.
The citizen pays a Lightning invoice in satoshis, created by Bitnob. Once the payment is confirmed, the
server issues a signed credential and a PDF. Anyone can verify the certificate by its public id.

Three parts make up the system:

| Part | Folder | Role |
|---|---|---|
| Backend | `backend-nest/` | NestJS + TypeORM + PostgreSQL, API under `/api` on port **3001** |
| Citizen app | `frontmobile/` | Expo / React Native. Calls only `backend-nest` |
| Staff console | `frontweb/` | TanStack Start web app for organization staff (port 3000 in dev) |

## Key concepts

- **Certificate request** (`admin_certificate_requests`): one citizen's request for one certificate type.
  Its statuses (`pending`, `accepted`, `needs_info`, `awaiting_payment`, `paid`, `issuing`, `issued`, `rejected`)
  are described in `BUSINESS_RULES.md` §2.
- **Organization** (`organizations`): a `municipality` or `ministry` that issues certificates. Staff users belong
  to exactly one organization. Staff only see and act on requests of their own organization.
- **Agent review**: a staff decision (accept, reject with reason, or ask for more information) taken *before*
  payment. Only types flagged `requiresReview` need it (residence, identity today). The other types can be
  accepted at filing when automatic issuance is on.
- **Sats**: prices are in satoshis (`priceSats`). The catalog has no FCFA price anymore.
- **Lightning invoice (BOLT11)**: the payment request the citizen pays. Created at Bitnob
  (the pay-in rail). A non-Bitnob invoice is refused, not settled (`PROVIDER_MISMATCH`). Its paid state is read back from Bitnob before it is trusted. A webhook only
  signals a change.
- **Payment ledger** (`payments`): one row per payment attempt, linked to its purpose
  (`purpose_type`, `purpose_id`). The invoice itself is in `lightning_invoices`.
- **Automatic issuance**: once a request is `paid`, the server issues the certificate without a human step
  (decision D2). A manual `issue` call exists only as a recovery path.
- **Declared, not verified data**: `submittedData` is what the holder typed. The server does not check it against
  any civil register. A certificate issued without review is marked `declaredNotVerified`.
- **Verifiable Credential (VC)**: a JWT signed with HS256 and a shared secret (`VC_SIGNING_SECRET`). Only this
  backend can verify it. A third party cannot, because there is no public key. The DID is local
  (`did:dioteko:<uuid>`), not resolvable.
- **Certificate id** (`external_reference`): the public identifier shown in the QR code and used for
  verification. It is also the PDF file name. Knowing it does not give access to the PDF.
- **Signed file link**: a 5-minute URL with an HMAC signature. The holder gets it from the API, and the phone
  browser opens it to download the PDF. The PDF is never public.
- **Anchoring**: the design wants the document hash anchored on the Bitcoin testnet. Today the anchor is
  **simulated** (random transaction id). Do not present it as proof of timestamp.
- **Access log** (`access_logs`): append-only audit trail of verifications, reviews, reads by staff and money
  movements. Issuance and revocation are not logged yet.
- **Consent** (`consents`): a holder's grant to a verifier organization. It is recorded but not checked yet.

## Identity

- **Mobile login** uses Google through **Appwrite**. The backend checks the Appwrite session live, then
  mints its own tokens (access JWT 15 min, refresh token 30 days, rotated).
- **Holder name**: no verified source yet. The name is declared by the holder (decision D3 is still open;
  see `docs/ROADMAP_NEXT_STEPS.md`). The Google profile name is copied into `users.display_name` at account creation
  and is not updated later.

## Admin screens in the mobile app

`frontmobile/app/admin/*` contains six screens that render, but they are backed by `mockApiCall` stubs in
`frontmobile/services/api.ts`. There is no backend for them. The real staff workflow is the web console
(`frontweb/`).
