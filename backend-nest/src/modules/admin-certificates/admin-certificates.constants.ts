import type { KycPolicy } from '../kyc/kyc-policy.util';

/**
 * Hardcoded certificate type catalog, ported from
 * `backend/src/controllers/certificateController.js`'s `getCertificateTypes`
 * (same ids, names, and prices — unchanged). Prices are in satoshis: this
 * project only ever priced certificates as a flat sats amount fed straight
 * into Lightning invoice creation (today Bitnob, `BitnobLightningService
 * .createInvoice({amountSats})`), so `priceSats` here is that same number,
 * just renamed for clarity (the old field was just `price`).
 *
 * `title` doubles as both the catalog display name (`GET /types`) and the
 * PDF header title (`getCertificateTitle` in the old
 * `certificateService.js`) — those two strings were identical for every
 * type in the old code, so this is a single source of truth instead of two
 * parallel maps that could drift apart.
 */
export interface AdminCertificateTypeDefinition {
  id: string;
  name: string;
  priceSats: number;
  /**
   * `true`: an agent of the organization must accept the request before it can be paid (it starts `pending`).
   * `false`: the data reproduces a civil-registry record, so the request is `accepted` automatically at filing.
   * Setting a type to `true` is the whole change needed to tighten it.
   */
  requiresReview: boolean;
  /**
   * Identity check (KYC) policy. `required`: the holder must have a `verified` KYC record to file or resubmit.
   * `planned`: mandatory in the end but not blocking yet (it is the family of acts about the holder's civil
   * record, where the parents' names must still be completed). A `planned` type becomes blocking via
   * `KYC_ENFORCED_TYPES`, then for good by changing this value to `required`. See `isKycEnforced`.
   */
  kyc: KycPolicy;
}

export const ADMIN_CERTIFICATE_TYPES: AdminCertificateTypeDefinition[] = [
  { id: 'birth', name: 'Birth Certificate Extract', priceSats: 100, requiresReview: false, kyc: 'planned' },
  { id: 'marriage', name: 'Marriage Certificate Extract', priceSats: 100, requiresReview: false, kyc: 'planned' },
  { id: 'death', name: 'Death Certificate Extract', priceSats: 100, requiresReview: false, kyc: 'planned' },
  { id: 'residence', name: 'Certificate of Residence', priceSats: 100, requiresReview: true, kyc: 'required' },
  { id: 'identity', name: 'Identity Certificate', priceSats: 100, requiresReview: true, kyc: 'required' },
];

/**
 * Keys a holder may put in `submittedData`, for every type (the mobile form `app/certificate/new.tsx` sends exactly
 * these). `submittedData` becomes the credential subject verbatim, so anything else is refused rather than signed.
 * Values must be non-empty strings of at most `SUBMITTED_DATA_MAX_VALUE_LENGTH` characters.
 */
export const SUBMITTED_DATA_ALLOWED_KEYS = [
  'fullName',
  'dateOfBirth',
  'placeOfBirth',
  'fatherName',
  'motherName',
  'nationality',
  'idNumber',
] as const;
export const SUBMITTED_DATA_REQUIRED_KEYS = ['fullName'] as const;
export const SUBMITTED_DATA_MAX_VALUE_LENGTH = 200;

/** Bounds of the free-text reason/message an agent writes when rejecting or asking for more information. */
export const DECISION_TEXT_MIN_LENGTH = 10;
export const DECISION_TEXT_MAX_LENGTH = 500;

/** Fallback PDF title for a `certificateType` not present in the catalog above — matches the old `getCertificateTitle`'s default. */
export const DEFAULT_CERTIFICATE_TITLE = 'Administrative Certificate';

export function getCertificateTypeDefinition(certificateType: string): AdminCertificateTypeDefinition | undefined {
  return ADMIN_CERTIFICATE_TYPES.find((definition) => definition.id === certificateType);
}

/** Matches old `certificateService.getCertificateTitle(type)` — same lookup-with-fallback behavior. */
export function getCertificateTitle(certificateType: string): string {
  return getCertificateTypeDefinition(certificateType)?.name ?? DEFAULT_CERTIFICATE_TITLE;
}

/**
 * Validity of an issued certificate, derived live from the credential (`verifiable_credentials.status` and
 * `expires_at`) — nothing persists it. `expiring_soon` = still valid but expiring within
 * `EXPIRING_SOON_DAYS`.
 */
export const CERTIFICATE_VALIDITIES = ['valid', 'expiring_soon', 'expired', 'revoked'] as const;
export type CertificateValidity = (typeof CERTIFICATE_VALIDITIES)[number];

export const EXPIRING_SOON_DAYS = 30;

/** `Payment.purposeType` tag for admin-certificate-request Lightning invoices — see `Payment.purposeType`'s doc comment in payments/lightning. */
export const ADMIN_CERTIFICATE_REQUEST_PURPOSE_TYPE = 'admin_certificate_request';

/** `Payment.purposeType` tag for the Bitnob fiat payout tied to an issued
 * certificate — mirrors the sibling `admin_certificate_request` tag. */
export const ADMIN_CERTIFICATE_BITNOB_PAYOUT_PURPOSE_TYPE = 'admin_certificate_bitnob_payout';

/** VC `type` string passed to `CredentialIssuanceService.issue()` and checked by `IssuancePolicyService`. */
export const ADMIN_CERTIFICATE_VC_TYPE = 'AdminCertificate';
