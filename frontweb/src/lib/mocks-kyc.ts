import type {
  ApiError,
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

const build = (): KycReviewDetail[] => [
  seed(1, "Awa Diallo", "fallback", "document_unreadable", 0.2),
  seed(2, "Cheikh Ba", "fallback", "document_unreadable", 0.6),
  seed(3, "Mariama Sarr", "manual_only", null, 1.1),
  seed(4, "Ousmane Fall", "provider", "selfie_mismatch", 2.4),
  seed(5, "Khady Gueye", "fallback", "other", 3.3),
];

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
  const rows = DB.filter(
    (r) =>
      r.status === (f.status && f.status !== "all" ? f.status : "manual_review") &&
      (!f.origin || f.origin === "all" || r.origin === f.origin),
  ).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const page = f.page ?? 1;
  return { items: rows.slice((page - 1) * 20, page * 20), total: rows.length, page, pageSize: 20 };
}

export async function mockGetKycReview(token: string | null, id: string) {
  await wait();
  if (!can(userFromToken(token), "kyc.review")) fail(403, "Accès refusé.");
  return find(id);
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
  return { id: r.id, status: r.status };
}
