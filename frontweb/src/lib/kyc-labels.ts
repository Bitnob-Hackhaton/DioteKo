import type { KycOcrFieldKey, KycReviewOrigin, KycReviewStatus } from "./types";

export const KYC_STATUS_LABELS: Record<KycReviewStatus, string> = {
  manual_review: "À relire",
  verified: "Identité validée",
  rejected: "Rejeté",
};

/** Valeurs du filtre « Statut » de la console : les trois états plus « Tous les états » (`all`). */
export const KYC_STATUS_FILTER_LABELS: Record<KycReviewStatus | "all", string> = {
  ...KYC_STATUS_LABELS,
  all: "Tous les états",
};

export const KYC_ORIGIN_LABELS: Record<KycReviewOrigin, string> = {
  provider: "Demandée par le fournisseur",
  fallback: "Contrôle automatique en échec",
  manual_only: "Vérification manuelle",
  auto: "Vérification automatique",
};

/** Noms de contrôles de la concordance recto / verso (`cross_validation`), en clair ; sinon le nom brut. */
export const KYC_CHECK_LABELS: Record<string, string> = {
  full_name: "Nom complet",
  name: "Nom",
  date_of_birth: "Date de naissance",
  dob: "Date de naissance",
  id_number: "Numéro de la pièce",
  document_number: "Numéro de la pièce",
  expiry_date: "Date d'expiration",
  nationality: "Nationalité",
  sex: "Sexe",
  mrz: "Zone MRZ",
};

export const kycCheckLabel = (name: string): string => KYC_CHECK_LABELS[name] ?? name;

/** Motifs techniques posés par le backend (`failure_reason`), traduits pour l'agent. */
export const KYC_REASON_LABELS: Record<string, string> = {
  document_unreadable: "Document ou MRZ illisible",
  document_expired: "Document expiré",
  selfie_mismatch: "Selfie non concordant",
  liveness_failed: "Preuve de vie échouée",
  rejected: "Rejet définitif du fournisseur",
  other: "Autre",
};

/** Codes de rejet du prestataire (`rejection_reason`), en clair pour l'agent. */
export const KYC_PROVIDER_CODE_LABELS: Record<string, string> = {
  FRONT_OCR_FAILED: "Le recto n'a pas pu être lu : aucun champ exploitable détecté.",
  BACK_OCR_FAILED: "Le verso n'a pas pu être lu : aucun champ exploitable détecté.",
  BACK_MRZ_CHECKSUM_FAILED:
    "La zone MRZ du verso est illisible ou ses sommes de contrôle sont fausses.",
  CROSS_VALIDATION_FAILED: "Le recto et le verso ne concordent pas.",
  FACE_MATCH_FAILED: "Le visage du selfie ne correspond pas à celui de la pièce.",
  LIVENESS_FAILED: "La preuve de vie du selfie a échoué.",
  DOCUMENT_EXPIRED: "Le document est expiré.",
  HARD_REJECTED: "Le service a rejeté définitivement le dossier, sans en préciser la cause.",
};

/** Libellé lisible d'un code du prestataire : exact, sinon déduit des mots-clés, sinon le code brut. */
export function kycProviderCodeLabel(code: string): string {
  const exact = KYC_PROVIDER_CODE_LABELS[code];
  if (exact) return exact;
  const text = code.toLowerCase();
  if (/liveness|spoof|deepfake|replay/.test(text))
    return KYC_PROVIDER_CODE_LABELS["LIVENESS_FAILED"]!;
  if (/expir/.test(text)) return KYC_PROVIDER_CODE_LABELS["DOCUMENT_EXPIRED"]!;
  if (/tamper|forg|fraud|fake|manipul|spoof/.test(text)) {
    return "Soupçon de falsification du document : examinez-le avec attention.";
  }
  if (/face|selfie|biometric/.test(text)) return KYC_PROVIDER_CODE_LABELS["FACE_MATCH_FAILED"]!;
  if (/mrz|barcode/.test(text)) return KYC_PROVIDER_CODE_LABELS["BACK_MRZ_CHECKSUM_FAILED"]!;
  if (/cross_validation|mismatch/.test(text))
    return KYC_PROVIDER_CODE_LABELS["CROSS_VALIDATION_FAILED"]!;
  if (/ocr|blur|unreadable|illegible|quality|glare|dark|resolution/.test(text)) {
    return "Le document n'a pas pu être lu correctement par la vérification automatique.";
  }
  return `Code du prestataire : ${code}`;
}

/** Champs lus par l'OCR, dans l'ordre d'affichage. */
export const KYC_OCR_FIELD_LABELS: Record<KycOcrFieldKey, string> = {
  full_name: "Nom complet",
  date_of_birth: "Date de naissance",
  id_number: "Numéro de la pièce",
  expiry_date: "Date d'expiration",
  nationality: "Nationalité",
  sex: "Sexe",
  place_of_birth: "Lieu de naissance",
  issue_date: "Date de délivrance",
  issuing_country: "Pays émetteur",
};

export type KycConfidenceLevel = "high" | "medium" | "low";

export const KYC_CONFIDENCE_LABELS: Record<KycConfidenceLevel, string> = {
  high: "Élevée",
  medium: "Moyenne",
  low: "Faible",
};

/** Seuils de lecture : au-dessus de 85 % la lecture est fiable, sous 60 % elle est à vérifier à l'œil. */
export function kycConfidenceLevel(confidence: number): KycConfidenceLevel {
  return confidence >= 0.85 ? "high" : confidence >= 0.6 ? "medium" : "low";
}

/** Étapes de session du prestataire, en clair. */
export const KYC_PROVIDER_STEP_LABELS: Record<string, string> = {
  HARD_REJECTED: "Rejet définitif",
  COMPLETE: "Terminée",
  AWAITING_FRONT: "En attente du recto",
  AWAITING_BACK: "En attente du verso",
  AWAITING_LIVE: "En attente du selfie",
};
