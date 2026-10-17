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
/** `provider` = Idswyft a demandé une relecture ; `fallback` = contrôle automatique en échec ; `manual_only` = Idswyft désactivé. */
export type KycReviewOrigin = "provider" | "fallback" | "manual_only";
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
}

export interface KycReviewDetail extends KycReviewSummary {
  availableDocuments: KycDocumentKind[];
  attempts: number;
  reviewedByName?: string | undefined;
  reviewedAt?: string | undefined;
  reviewNote?: string | undefined;
}

export interface KycReviewFilters {
  status?: KycReviewStatus | "all" | undefined;
  origin?: KycReviewOrigin | "all" | undefined;
  page?: number | undefined;
}
