import type { KycReviewOrigin, KycReviewStatus } from "./types";

export const KYC_STATUS_LABELS: Record<KycReviewStatus, string> = {
  manual_review: "À relire",
  verified: "Identité validée",
  rejected: "Rejeté",
};

export const KYC_ORIGIN_LABELS: Record<KycReviewOrigin, string> = {
  provider: "Demandée par le fournisseur",
  fallback: "Contrôle automatique en échec",
  manual_only: "Vérification manuelle",
};

/** Motifs techniques posés par le backend (`failure_reason`), traduits pour l'agent. */
export const KYC_REASON_LABELS: Record<string, string> = {
  document_unreadable: "Document ou MRZ illisible",
  document_expired: "Document expiré",
  selfie_mismatch: "Selfie non concordant",
  liveness_failed: "Preuve de vie échouée",
  rejected: "Rejet définitif du fournisseur",
  other: "Autre",
};
