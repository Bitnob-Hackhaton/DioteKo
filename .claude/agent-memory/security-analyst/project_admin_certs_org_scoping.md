---
name: admin-certificates org scoping review
description: Org isolation on admin-certificates staff/money routes; decided rule; planted 1-sat invoice FIXED; public PDF FIXED by 5-min signed links (PR #7); residual: QR carries only certificateId, file-link is holder-only; citizen 403 pitfall still open
metadata:
  type: project
---

Decided rule (user): every staff actor (issuer AND admin) is limited to their own organisation, org read from DB via `resolveActorOrganizationId`; foreign request/certificate answers 404; holder keeps own request (invoice + status) but not `issue`; payouts require `ref.organizationId === actor org`.

Findings beyond the known gap:
- FIXED: a caller could choose `purposeType`/`purposeId` for an invoice, and `findOpenInvoiceForRequest` reused a pending invoice with no amount check (1-sat invoice hole). Now: the `admin_certificate` prefix is rejected by `create-invoice.dto.ts` (400), and `findOpenInvoiceForRequest` only reuses an invoice whose `amountSats` equals the catalog price. Regression test: `admin-certificates-payment.service.spec.ts` ("planted 1-sat invoice").
- `resolveActorOrganizationId` throws 403 for any user without an organisation (every normal citizen) -> must not be called on the holder path.
- FIXED (PR #7): `GET :certificateId/file` is no longer open: it needs a signed `exp`+`sig` link valid 5 minutes (`certificate-file-link.service.ts`), obtained from the authenticated, holder-only `GET requests/:requestId/file-link`. Residual: the PDF still embeds submittedData (PII) for the link bearer, and the QR carries only the `certificateId` (verification, not file access).
- FIXED (lot 3 + commit `b5d1c2e`): `issueForRequest` had no atomic PAID->ISSUED claim. Now: atomic `paid -> issuing` with a token, PDF generation inside the discard protection, orphan VCs revoked on retry.

**Why:** money routes + cross-org PII. **How to apply:** when reviewing the follow-up diff, check scope check runs BEFORE refreshRequestPayment/syncRequestPaymentFromLedger (they mutate state and call Bitnob), and that 403/404 are not distinguishable.
