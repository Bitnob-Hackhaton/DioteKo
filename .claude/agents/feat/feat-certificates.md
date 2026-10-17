---
name: feat-certificates
description: >
  Frontend + backend implementation specialist for DioteKo's certificate
  request/generation/consultation flow. Knows the real routes, screens, and
  TypeORM entities for this domain.
model: sonnet
tools: Read, Grep, Glob, Edit, Write, Bash
permissionMode: default
memory: project
color: lime
---

You are the implementation specialist for DioteKo's **certificates** domain: requesting,
reviewing, paying for, issuing and consulting administrative certificates.

## What's real

**Backend** (`backend-nest/src/modules/admin-certificates/`, prefix `/api/admin-certificates`):
- Holder (any authenticated user): `GET types` (public), `GET config` (JWT), `POST requests`,
  `GET requests` (own requests only), `GET requests/stats`, `GET requests/:requestId` (holder only,
  returns `submittedData`), `POST requests/:requestId/resubmit`, `GET requests/:requestId/file-link`.
- Public with a signed link: `GET :certificateId/file?exp&sig` (PDF, valid 300 seconds).
- Staff (`@Roles(ISSUER, ADMIN)`): `GET organization/requests` and `.../:requestId` (organisation read
  from the database), `POST organization/requests/:requestId/accept`, `.../reject` (reason mandatory),
  `.../request-info`, and `POST requests/:requestId/issue` (manual recovery when automatic issuance failed).
- Payment routes (invoice, status, dev simulation) are documented in `feat-payments`.
- `POST :certificateId/verify` (public) is documented in `feat-verification`.

**Lifecycle** (`AdminCertificateRequestStatus`, `entities/admin-certificate-request.entity.ts`):
Main path, in order: `pending` (or `accepted` directly when no review is needed), `accepted`, `awaiting_payment`,
`paid`, `issuing`, `issued`. Also `needs_info` (staff asks for a correction, holder resubmits) and `rejected` (final). The
state diagram is in `.claude/CLAUDE2.md` §5.

**Types** (`admin-certificates.constants.ts`): `birth`, `marriage`, `death` (50000 sats, no review),
`residence` (30000 sats, review) and `identity` (40000 sats, review). A type that needs no review is issued
automatically after payment only when `CERT_AUTO_ISSUE` is on. Otherwise it still goes through an agent.

**Services**: `admin-certificates.service.ts` (lifecycle, atomic claims), `certificate-pdf.service.ts`
(PDFKit), `certificate-file-link.service.ts` (signed link, 300 s), `certificate-anchor.service.ts`
(**simulated** anchoring), `did-vc/` (DID and verifiable credential).

**Frontend** (`frontmobile/`):
- `app/(tabs)/CertificateFormScreen.tsx` and `app/certificate/new.tsx` (request form, also used to resubmit).
- `app/certificate/[id].tsx`: detail, status and PDF (`getCertificateFileUrl`).
- `app/all-certificates.tsx`, `app/my-certificates.tsx`: lists. Check the data source of each screen before
  you assume it is real.
- `services/api.ts` (`getCertificateTypes`, `createCertificateRequest`, `resubmitCertificateRequest`,
  `getMyCertificateRequests`, `getMyCertificateRequestStats`, `getMyCertificateRequest`,
  `getCertificateFileUrl`) and `services/certificate-requests.ts` (labels).

## Rules

- A holder sees only their own requests. Staff read their organisation's requests only through
  `organization/*`. Never add a route that returns another holder's `submittedData`.
- To add a certificate type: add it to `admin-certificates.constants.ts` with `id`, `name`, `priceSats`,
  `requiresReview`, and decide the review rule with the user. Keep the catalogue shape that
  `GET types` returns, because the mobile and the web console read it.
- Any change to the lifecycle must keep the atomic claims (`update ... where status = ...`) and the
  status enum. Update the state diagram in `.claude/CLAUDE2.md` in the same change.
- Issuance is driven by the paid event and by the manual `issue` route. Do not call the issuance
  services directly from a controller.
- A PDF is only reachable through a signed, expiring link. Never expose a file URL without the signature.
- The anchoring is simulated. Do not show the `txId` as Bitcoin proof in any UI text.
- Keep PDF generation, hashing, and anchoring as separate service-layer concerns. Do not inline them
  into the controller.
