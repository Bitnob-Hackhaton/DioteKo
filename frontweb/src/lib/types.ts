// `pending` = déposée, à vérifier par un agent ; `accepted` = le citoyen peut payer ; `needs_info` = complément
// demandé ; `issuing` = certificat en cours de génération (automatique après paiement).
export type RequestStatus =
  | "pending"
  | "accepted"
  | "needs_info"
  | "awaiting_payment"
  | "paid"
  | "issuing"
  | "issued"
  | "rejected";
export type OrgRole = "org_owner" | "registrar" | "approver" | "finance_officer" | "auditor";
export type PlatformRole = "super_admin";

export interface Organization {
  id: string;
  name: string;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  roles: OrgRole[];
  platformRole?: PlatformRole | undefined;
  organization: Organization;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface CertificateType {
  id: string;
  name: string;
  priceSats: number;
}

export interface Recommendation {
  decision: "issue" | "reject";
  reason?: string | undefined;
  byId: string;
  byName: string;
  at: string;
}

export interface TimelineEvent {
  kind: "created" | "invoice" | "paid" | "recommended" | "issued" | "rejected";
  label: string;
  at: string;
  actor?: string | undefined;
}

export interface Note {
  id: string;
  authorName: string;
  authorRole: OrgRole;
  body: string;
  at: string;
}

export interface CertificateRequestSummary {
  id: string;
  reference: string;
  typeId: string;
  typeName: string;
  holderName: string;
  createdAt: string;
  /** `null` = the server has not priced this request yet (never display it as 0). */
  amountSats: number | null;
  status: RequestStatus;
  paidAt?: string | undefined;
}

export interface IssueResult {
  certificateId: string;
  documentHash: string;
  blockchainAnchor: {
    txId: string;
    network: string;
    timestamp: string;
    blockHeight: number | null;
  };
  validUntil: string;
  qrCodeData: string;
}

export interface CertificateRequestDetail extends CertificateRequestSummary {
  submittedData: Record<string, string>;
  paymentHash?: string | undefined;
  timeline: TimelineEvent[];
  notes: Note[];
  recommendation?: Recommendation | undefined;
  rejectionReason?: string | undefined;
  /** Message de l'agent quand un complément est demandé (`needs_info`). */
  infoRequest?: string | undefined;
  /** Identifiant du certificat émis (réel : renvoyé par le serveur ; la génération n'a pas de `IssueResult` local). */
  certificateId?: string | null | undefined;
  issued?: IssueResult | undefined;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RequestFilters {
  status?: RequestStatus | "all" | undefined;
  type?: string | undefined;
  q?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page?: number | undefined;
}

export interface ApiError {
  statusCode: number;
  message: string;
}

export type CertificateStatus = "valid" | "expired" | "revoked";

export interface Certificate {
  id: string;
  requestId: string;
  reference: string;
  typeId: string;
  typeName: string;
  holderName: string;
  issuedAt: string;
  validUntil: string;
  status: CertificateStatus;
  documentHash: string;
  anchor: { txId: string; network: string; timestamp: string; blockHeight: number | null };
  issuedBy?: string | undefined;
  revocation?: { reason: string; byName: string; at: string } | undefined;
}

export interface CertificateFilters {
  status?: CertificateStatus | "all" | undefined;
  type?: string | undefined;
  q?: string | undefined;
  page?: number | undefined;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string | undefined;
  certificateType: string;
  issuedAt: string;
  expiresAt: string;
}

export interface DashboardStats {
  paidToProcess: number;
  issued30d: number;
  satsCollected30d: number;
  avgDelayMinutes: number | null;
  series: {
    date: string;
    awaiting_payment: number;
    paid: number;
    issued: number;
    rejected: number;
  }[];
  oldestPaid: CertificateRequestSummary[];
}

export interface AuditEntry {
  id: string;
  at: string;
  actorName: string;
  actorRole: string;
  action: string;
  object: string;
}

export interface AuditFilters {
  actor?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page?: number | undefined;
}

// ---------------------------------------------------------------- KYC manual review (see docs/PLAN_KYC_MANUAL_REVIEW.md)
/**
 * `provider` = Idswyft a demandé une relecture ; `fallback` = contrôle automatique en échec ; `manual_only` = Idswyft
 * désactivé ; `auto` = le fournisseur a validé le dossier seul, sans agent (consultation en lecture seule).
 */
export type KycReviewOrigin = "provider" | "fallback" | "manual_only" | "auto";
export type KycDocumentKind = "front" | "back" | "selfie";
export type KycReviewStatus = "manual_review" | "verified" | "rejected";
export type KycReviewDecision = "approve" | "reject";

export interface KycReviewSummary {
  id: string;
  reference: string;
  /** Nom du titulaire : le serveur ne le renvoie qu'aux rôles autorisés. */
  holderName: string;
  origin: KycReviewOrigin;
  documentType: string | null;
  issuingCountry: string | null;
  status: KycReviewStatus;
  /** Motif technique du basculement (ex. `document_unreadable`), jamais de donnée personnelle. */
  failureReason: string | null;
  createdAt: string;
  /** Présent pour un dossier validé. */
  verifiedAt?: string | undefined;
}

/** Champs OCR conservés par le serveur (ordre d'affichage). */
export type KycOcrFieldKey =
  | "full_name"
  | "date_of_birth"
  | "id_number"
  | "expiry_date"
  | "nationality"
  | "sex"
  | "place_of_birth"
  | "issue_date"
  | "issuing_country";

export interface KycOcrField {
  key: KycOcrFieldKey;
  /** Donnée personnelle lue sur la pièce : réservée à l'agent, jamais journalisée. */
  value: string;
  /** 0..1, ou `null` si le prestataire n'en a pas donné pour ce champ. */
  confidence: number | null;
}

export interface KycScore {
  /** 0..1 */
  score: number | null;
  passed: boolean | null;
  verdict: string | null;
}

/** Ce que la vérification automatique (Idswyft) a lu et comment elle a noté le dossier. */
export interface KycAssessment {
  version: number;
  readAt: string;
  /** Étape de la session chez le prestataire (`HARD_REJECTED`, `COMPLETE`...). */
  providerStep: string | null;
  finalResult: string | null;
  /** Code stable du prestataire (ex. `FRONT_OCR_FAILED`). */
  rejectionCode: string | null;
  rejectionDetail: string | null;
  ocr: { fields: KycOcrField[]; confidence: number | null } | null;
  crossValidation: KycScore | null;
  faceMatch: KycScore | null;
  liveness: KycScore | null;
  riskScore: number | null;
}

/**
 * `available` = lectures disponibles ; `no_data` = le prestataire a répondu sans rien lire ; `unavailable` = rien de
 * conservé (panne, expiré, clé changée) ; `not_run` = mode manuel, aucun contrôle automatique.
 */
export type KycAssessmentState = "available" | "no_data" | "unavailable" | "not_run";

export interface KycAssessmentView {
  state: KycAssessmentState;
  assessment: KycAssessment | null;
}

export interface KycAutoAuditScore {
  /** 0..1 */
  score: number | null;
  /** Minimum exigé par le fournisseur (0..1), `null` s'il ne l'a pas donné. */
  threshold: number | null;
  passed: boolean | null;
}

export interface KycAutoAuditCheck {
  /** Nom du champ comparé (ex. `date_of_birth`), jamais sa valeur. */
  name: string;
  passed: boolean | null;
  score: number | null;
}

/**
 * Trace d'un dossier validé par le fournisseur seul : scores, seuils et indicateurs. Aucune photo, aucun texte lu sur la
 * pièce, aucun nom (minimisation des données).
 */
export interface KycAutoAudit {
  version: number;
  readAt: string;
  providerVerdict: string | null;
  /** Fournisseur en mode bac à sable : verdict non fiable en production. `null` s'il ne l'a pas dit. */
  isSandbox: boolean | null;
  faceMatch: KycAutoAuditScore | null;
  liveness: KycAutoAuditScore | null;
  crossValidation: {
    verdict: string | null;
    passed: boolean | null;
    score: number | null;
    checks: KycAutoAuditCheck[];
  } | null;
  documentExpired: boolean | null;
}

/** `unavailable` = rien de conservé (dossier antérieur à la trace, rétention dépassée, clé absente ou changée). */
export interface KycAutoAuditView {
  state: "available" | "unavailable";
  audit: KycAutoAudit | null;
}

export interface KycReviewDetail extends KycReviewSummary {
  availableDocuments: KycDocumentKind[];
  attempts: number;
  reviewedByName?: string | undefined;
  reviewedAt?: string | undefined;
  reviewNote?: string | undefined;
  /** Route de détail uniquement, dossier en attente de décision ; absent de la liste. */
  assessment?: KycAssessmentView | undefined;
  /** Route de détail uniquement, dossier validé par le fournisseur seul (origine `auto`) ; absent de la liste. */
  autoAudit?: KycAutoAuditView | undefined;
}

export interface KycReviewFilters {
  /** Absent = la file de travail (« À relire ») ; `all` = tous les états. */
  status?: KycReviewStatus | "all" | undefined;
  origin?: KycReviewOrigin | "all" | undefined;
  page?: number | undefined;
}
