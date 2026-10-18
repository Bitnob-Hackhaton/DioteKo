import type {
  ApiError,
  KycAssessment,
  KycAssessmentView,
  KycAutoAudit,
  KycAutoAuditView,
  KycDocumentKind,
  KycReviewDecision,
  KycReviewDetail,
  KycReviewFilters,
  KycReviewOrigin,
  Paginated,
} from "./types";
import { can } from "./permissions";
import { MOCK_USERS } from "./mocks";

const LATENCY = 400;
const wait = () => new Promise((r) => setTimeout(r, LATENCY));
const fail = (statusCode: number, message: string): never => {
  throw { statusCode, message } satisfies ApiError;
};

const DAY = 86_400_000;
const seed = (
  n: number,
  holderName: string,
  origin: KycReviewOrigin,
  failureReason: string | null,
  ageDays: number,
): KycReviewDetail => ({
  id: `kyc-${n}`,
  reference: `KYC-${String(n).padStart(6, "0")}`,
  holderName,
  origin,
  documentType: "Carte d'identité CEDEAO",
  issuingCountry: "SN",
  status: "manual_review",
  failureReason,
  createdAt: new Date(Date.now() - ageDays * DAY).toISOString(),
  availableDocuments: ["front", "back", "selfie"],
  attempts: 1 + (n % 3),
});

/** Les quatre états que l'agent peut rencontrer : rien de lu, lecture partielle, lecture complète, aucun contrôle automatique. */
const assessment = (over: Partial<KycAssessment>): KycAssessment => ({
  version: 1,
  readAt: new Date(Date.now() - 3_600_000).toISOString(),
  providerStep: "COMPLETE",
  finalResult: "manual_review",
  rejectionCode: null,
  rejectionDetail: null,
  ocr: null,
  crossValidation: null,
  faceMatch: null,
  liveness: null,
  riskScore: null,
  ...over,
});

const ASSESSMENTS: Record<number, KycAssessmentView> = {
  // Réponse réelle de la pile de dev : rien n'a pu être lu sur le recto.
  1: {
    state: "no_data",
    assessment: assessment({
      providerStep: "HARD_REJECTED",
      finalResult: "failed",
      rejectionCode: "FRONT_OCR_FAILED",
      rejectionDetail: "No required OCR fields could be read from the document",
    }),
  },
  2: {
    state: "available",
    assessment: assessment({
      providerStep: "HARD_REJECTED",
      finalResult: "failed",
      rejectionCode: "BACK_MRZ_CHECKSUM_FAILED",
      ocr: {
        confidence: 0.58,
        fields: [
          { key: "full_name", value: "TEST HOLDER A", confidence: 0.74 },
          { key: "date_of_birth", value: "2000-01-01", confidence: 0.41 },
          { key: "id_number", value: "X-000-0001", confidence: 0.52 },
          { key: "expiry_date", value: "2031-02-09", confidence: null },
        ],
      },
      crossValidation: { score: 0.46, passed: false, verdict: "FAIL" },
      riskScore: 0.62,
    }),
  },
  3: { state: "not_run", assessment: null },
  4: {
    state: "available",
    assessment: assessment({
      ocr: {
        confidence: 0.93,
        fields: [
          { key: "full_name", value: "TEST HOLDER B", confidence: 0.97 },
          { key: "date_of_birth", value: "2000-02-02", confidence: 0.95 },
          { key: "id_number", value: "X-000-0002", confidence: 0.9 },
          { key: "expiry_date", value: "2029-05-30", confidence: 0.88 },
          { key: "nationality", value: "SÉNÉGALAISE", confidence: 0.86 },
        ],
      },
      crossValidation: { score: 0.91, passed: true, verdict: "PASS" },
      faceMatch: { score: 0.41, passed: false, verdict: "FAIL" },
      liveness: { score: 0.88, passed: true, verdict: null },
      riskScore: 0.34,
    }),
  },
  // Panne du prestataire : aucune donnée, l'agent le voit explicitement.
  5: { state: "unavailable", assessment: null },
};

/**
 * Dossier validé par le fournisseur seul : aucune photo, aucun texte lu, seulement la trace réduite. Le n°6 reprend le cas
 * observé le 2026-10-18 (pièce d'une autre personne, visage 0,905 pour un seuil de 0,55, fournisseur en bac à sable).
 */
const autoAudit = (over: Partial<KycAutoAudit>): KycAutoAudit => ({
  version: 1,
  readAt: new Date(Date.now() - 3_600_000).toISOString(),
  providerVerdict: "verified",
  isSandbox: false,
  faceMatch: { score: 0.93, threshold: 0.55, passed: true },
  liveness: { score: 0.91, threshold: null, passed: true },
  crossValidation: {
    verdict: "PASS",
    passed: true,
    score: 0.95,
    checks: [
      { name: "date_of_birth", passed: true, score: 1 },
      { name: "id_number", passed: true, score: 0.97 },
      { name: "expiry_date", passed: true, score: 1 },
    ],
  },
  documentExpired: false,
  ...over,
});

const seedDecided = (
  n: number,
  holderName: string,
  origin: KycReviewOrigin,
  status: "verified" | "rejected",
  ageDays: number,
): KycReviewDetail => ({
  ...seed(n, holderName, origin, status === "rejected" ? "rejected" : null, ageDays),
  status,
  availableDocuments: [],
  ...(status === "verified"
    ? { verifiedAt: new Date(Date.now() - ageDays * DAY + 600_000).toISOString() }
    : {}),
  ...(origin !== "auto"
    ? {
        reviewedByName: "Agent de démonstration",
        reviewedAt: new Date(Date.now() - ageDays * DAY + 3_600_000).toISOString(),
        reviewNote: "Décision de démonstration.",
      }
    : {}),
});

const AUTO_AUDITS: Record<number, KycAutoAuditView> = {
  6: {
    state: "available",
    audit: autoAudit({
      isSandbox: true,
      faceMatch: { score: 0.905, threshold: 0.55, passed: true },
    }),
  },
  // Validé avant l'existence de la trace : rien n'est conservé.
  7: { state: "unavailable", audit: null },
};

const build = (): KycReviewDetail[] => [
  ...[
    seed(1, "Awa Diallo", "fallback", "document_unreadable", 0.2),
    seed(2, "Titulaire Test 2", "fallback", "document_unreadable", 0.6),
    seed(3, "Mariama Sarr", "manual_only", null, 1.1),
    seed(4, "Titulaire Test 4", "provider", "selfie_mismatch", 2.4),
    seed(5, "Khady Gueye", "fallback", "other", 3.3),
  ].map((r, i) => ({ ...r, assessment: ASSESSMENTS[i + 1] })),
  { ...seedDecided(6, "Aminata Sy", "auto", "verified", 0.1), autoAudit: AUTO_AUDITS[6] },
  { ...seedDecided(7, "Fatou Ndiaye", "auto", "verified", 5), autoAudit: AUTO_AUDITS[7] },
  seedDecided(8, "Moussa Sow", "fallback", "verified", 4),
  seedDecided(9, "Ibrahima Thiam", "provider", "rejected", 6),
];

/** Comme le serveur : la liste ne porte jamais l'évaluation ni la trace (personnelles), seule la route de détail les renvoie. */
const withoutAssessment = ({
  assessment: _assessment,
  autoAudit: _autoAudit,
  ...rest
}: KycReviewDetail): KycReviewDetail => rest;

/** Détail d'un dossier décidé : l'évaluation est supprimée avec les pièces, la trace réduite reste. */
const withoutOnlyAssessment = ({
  assessment: _assessment,
  ...rest
}: KycReviewDetail): KycReviewDetail => rest;

let DB = build();

export function resetMockKycDb() {
  DB = build();
}

const userFromToken = (token: string | null) => {
  const u = MOCK_USERS.find((m) => token?.includes(m.id));
  return u ?? fail(401, "Session expirée.");
};

const find = (id: string) => DB.find((r) => r.id === id) ?? fail(404, "Dossier introuvable.");

export async function mockListKycReviews(
  token: string | null,
  f: KycReviewFilters,
): Promise<Paginated<KycReviewDetail>> {
  await wait();
  if (!can(userFromToken(token), "kyc.review")) fail(403, "Accès refusé.");
  // Comme le serveur : sans filtre, la file de travail ; `all` = tous les états. File « À relire » : plus ancien d'abord ;
  // les autres vues sont un historique, plus récent d'abord.
  const status = f.status ?? "manual_review";
  const rows = DB.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      (!f.origin || f.origin === "all" || r.origin === f.origin),
  ).sort((a, b) =>
    status === "manual_review"
      ? a.createdAt.localeCompare(b.createdAt)
      : b.createdAt.localeCompare(a.createdAt),
  );
  const page = f.page ?? 1;
  return {
    items: rows.slice((page - 1) * 20, page * 20).map(withoutAssessment),
    total: rows.length,
    page,
    pageSize: 20,
  };
}

export async function mockGetKycReview(token: string | null, id: string) {
  await wait();
  if (!can(userFromToken(token), "kyc.review")) fail(403, "Accès refusé.");
  const r = find(id);
  // Une fois le dossier décidé, l'évaluation est supprimée avec les pièces (la trace d'une vérification automatique reste).
  return r.status === "manual_review" ? r : withoutOnlyAssessment(r);
}

/** Placeholder illustré : les vraies pièces ne transitent jamais par les mocks. */
export async function mockKycDocument(
  token: string | null,
  id: string,
  kind: KycDocumentKind,
): Promise<string> {
  await wait();
  if (!can(userFromToken(token), "kyc.review")) fail(403, "Accès refusé.");
  find(id);
  const label = { front: "Recto simulé", back: "Verso simulé", selfie: "Selfie simulé" }[kind];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="100%" height="100%" fill="#e7e5e4"/><text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#57534e">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export async function mockDecideKycReview(
  token: string | null,
  id: string,
  decision: KycReviewDecision,
  note: string,
) {
  await wait();
  const u = userFromToken(token);
  if (!can(u, "kyc.review")) fail(403, "Accès refusé.");
  if (note.trim().length < 10) fail(400, "La note doit contenir au moins 10 caractères.");
  const r = find(id);
  if (r.status !== "manual_review") fail(409, "Ce dossier a déjà été traité.");
  r.status = decision === "approve" ? "verified" : "rejected";
  r.reviewedByName = u.name;
  r.reviewedAt = new Date().toISOString();
  r.reviewNote = note.trim();
  delete r.assessment;
  return { id: r.id, status: r.status };
}
