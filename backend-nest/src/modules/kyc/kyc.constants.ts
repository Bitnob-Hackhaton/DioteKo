/**
 * Lifecycle of a `kyc_verifications` row. `pending` = documents still being sent or the provider is still
 * deciding; `verified` / `failed` / `manual_review` mirror Idswyft's `GET /api/v2/verify/:id/status`;
 * `rejected` = we closed it ourselves (hard rejection that cannot be retried on the same session).
 */
export enum KycStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  FAILED = 'failed',
  MANUAL_REVIEW = 'manual_review',
  REJECTED = 'rejected',
}

/**
 * Why a dossier sits in `manual_review`: the provider asked for it (`provider`), the automatic check failed and the
 * fallback flag sent it to an agent (`fallback`), or Idswyft is bypassed altogether (`manual_only`). The last two are
 * "detached" dossiers: no provider call is made for them, the photos are only kept (encrypted) for the agent.
 */
export const KYC_REVIEW_ORIGINS = ['provider', 'fallback', 'manual_only'] as const;
export type KycReviewOrigin = (typeof KYC_REVIEW_ORIGINS)[number];

/** Sides of a document dossier an agent can look at. */
export const KYC_DOCUMENT_KINDS = ['front', 'back', 'selfie'] as const;
export type KycDocumentKind = (typeof KYC_DOCUMENT_KINDS)[number];

/** Photos an agent needs to decide a dossier (the back exists for a national id only). */
export const kycRequiredKinds = (documentType: string): KycDocumentKind[] =>
  (KYC_DOCUMENT_TYPES_WITH_BACK as readonly string[]).includes(documentType) ? ['front', 'back', 'selfie'] : ['front', 'selfie'];

/** Prefix of the `provider_verification_id` of a dossier that never had a provider session (the column is NOT NULL UNIQUE). */
export const KYC_MANUAL_PROVIDER_ID_PREFIX = 'manual_';

/** Documents a holder may present. Narrowed after the B0 spike if the national ID is not read reliably. */
export const KYC_DOCUMENT_TYPES = ['national_id', 'passport'] as const;
export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number];

/** Documents with a back side to upload (a passport has a single data page). */
export const KYC_DOCUMENT_TYPES_WITH_BACK: readonly KycDocumentType[] = ['national_id'];

export const KYC_PROVIDER_IDSWYFT = 'idswyft';

/**
 * The only values stored in `kyc_verifications.failure_reason` and shown to the holder. The provider's own
 * wording can echo what it read on a document (a name, a number), so it is mapped here and never kept.
 */
export const KYC_FAILURE_REASONS = [
  'document_unreadable',
  'document_expired',
  'selfie_mismatch',
  'liveness_failed',
  'rejected',
  'other',
] as const;
export type KycFailureReason = (typeof KYC_FAILURE_REASONS)[number];

/** Error codes returned with a 504 / 503 when the provider gave no answer, so the app can word the message and reconcile. */
export const KYC_PROVIDER_TIMEOUT_CODE = 'KYC_PROVIDER_TIMEOUT';
export const KYC_PROVIDER_UNREACHABLE_CODE = 'KYC_PROVIDER_UNREACHABLE';

/** Error code returned (403) when a certificate request needs a verified identity the holder does not have. */
export const KYC_REQUIRED_CODE = 'KYC_REQUIRED';

/** Upload bound for document and selfie photos (the type is decided from the bytes, see `kyc-upload.util.ts`). */
export const KYC_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
