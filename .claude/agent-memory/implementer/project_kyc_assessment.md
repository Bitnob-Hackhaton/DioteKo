---
name: kyc-assessment-vault
description: KYC agent review shows what Idswyft read (OCR + scores) as an encrypted kyc_documents row kind=assessment; no migration; design and gotchas
metadata:
  type: project
---

Automatic-check "assessment" (2026-10-18): `IdswyftStatusView.assessment` parsed by `kyc/kyc-assessment.util.ts`, stored by `KycDocumentVaultService.storeAssessment` as a `kyc_documents` row `kind='assessment'` (AES-GCM, AAD `id:assessment`, no migration since `kind` is an unconstrained varchar). Not in `KYC_DOCUMENT_KINDS`, so never a photo side. Exposed only in `KycReviewService.get` (`assessment: {state, assessment}` with states available/no_data/unavailable/not_run). Deleted by `deleteFor` with the photos.

Auto-verified audit (2026-10-18): dossier verified by provider alone (`review_origin` NULL) is listed read-only in the console (origin `auto` is DERIVED in KycReviewService, never stored; list status `all` = every state; non-queue views newest first). Reduced PII-free record = kyc_documents `kind='auto_audit'` (`kyc-auto-audit.util.ts`, parsed from the raw status body, written after `deleteFor`, needs only the key, not the fallback flag). Name matching vs account name was explicitly REJECTED by the user (Google name may differ from document): never add it. CRLF files: kyc.service.ts, kyc.service.spec.ts, kyc.constants.ts, frontweb types.ts (Edit tool preserves; node scripts must normalise).

Fallback rule REVERSED (2026-10-18, user): with KYC_FALLBACK_MANUAL_REVIEW on + vault key, EVERY provider refusal (any KycFailureReason, cross-validation, selfie, 404 session gone) detaches to the agent (pending/fallback -> manual_review once photos kept); `FALLBACK_REASONS` removed; classifier also reads the assessment rejectionCode. Fallback off / no key = old final failure. Mobile kyc.tsx re-asks a missing photo if still pending after the selfie.

**Why:** PII (OCR text) must stay encrypted and die with the photos; agent decides faster with the reading.

**How to apply:** Idswyft shapes for cross_validation/face_match/liveness are NOT pinned by a recorded sample (parser is alias-tolerant) - verify against a real success response. By design a front hard-rejection with fallback keeps the dossier `pending` (detached) so the app still collects back+selfie (agent needs all photos to approve); 409 on back precheck only when fallback is off/key missing. Gotchas: kyc.service.ts and its spec use CRLF (edit via node script preserving CRLF); backend has no ESLint config; Bash heredocs with quotes/backticks are fragile here, use the Write tool for scripts.
