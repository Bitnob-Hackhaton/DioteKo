import * as mocks from "./mocks";
import * as kycMocks from "./mocks-kyc";
import { USE_MOCKS } from "./format";
import type {
  ApiError,
  CertificateRequestDetail,
  CertificateRequestSummary,
  CertificateType,
  IssueResult,
  LoginResponse,
  Me,
  Paginated,
  RequestFilters,
  Certificate,
  CertificateFilters,
  VerifyResult,
  DashboardStats,
  AuditEntry,
  AuditFilters,
  OrgRole,
  RequestStatus,
  TimelineEvent,
  KycDocumentKind,
  KycReviewDecision,
  KycReviewDetail,
  KycReviewFilters,
} from "./types";

const BASE =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "http://localhost:3003/api";
const RT_KEY = "dioteko.rt";

// Access token lives in memory only.
let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export const tokens = {
  get access() {
    return accessToken;
  },
  set(res: LoginResponse) {
    accessToken = res.accessToken;
    sessionStorage.setItem(RT_KEY, res.refreshToken);
  },
  clear() {
    accessToken = null;
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(RT_KEY);
  },
  refresh(): string | null {
    return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(RT_KEY);
  },
  onExpired(cb: () => void) {
    onSessionExpired = cb;
  },
};

export function isApiError(e: unknown): e is ApiError {
  return typeof e === "object" && e !== null && "statusCode" in e && "message" in e;
}

async function tryRefresh(): Promise<boolean> {
  const rt = tokens.refresh();
  if (!rt) return false;
  try {
    const res = USE_MOCKS
      ? await mocks.mockRefresh(rt)
      : await raw<LoginResponse>("POST", "/auth/refresh", { refreshToken: rt }, false);
    tokens.set(res);
    return true;
  } catch {
    return false;
  }
}

async function raw<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (!res.ok) {
    let err: ApiError = { statusCode: res.status, message: res.statusText };
    try {
      err = (await res.json()) as ApiError;
    } catch {
      /* keep default */
    }
    throw err;
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** Runs a call once, refreshes silently on 401, retries once, then expires the session. */
async function withRefresh<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isApiError(e) && e.statusCode === 401) {
      if (await tryRefresh()) return fn();
      tokens.clear();
      onSessionExpired?.();
    }
    throw e;
  }
}

const qs = (f: Record<string, unknown>) => {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => v !== undefined && v !== "" && p.set(k, String(v)));
  const s = p.toString();
  return s ? `?${s}` : "";
};

// ------------------------------------------------------------------ real API (Nest) adapter
// The console was designed before the backend: these helpers translate what Nest returns into the shapes the
// screens already use. Anything Nest does not provide yet is left out (see `unavailable`).

/** View returned by `GET admin-certificates/organization/requests[/:id]` (staff side). */
interface NestRequestView {
  id: string;
  certificateType: string;
  status: RequestStatus;
  priceSats: number | null;
  decisionReason: string | null;
  certificateId: string | null;
  createdAt: string;
  updatedAt: string;
  submittedData?: Record<string, unknown>;
}

const REAL_PAGE_SIZE = 20;

const unavailable = <T>(): Promise<T> =>
  Promise.reject({
    statusCode: 501,
    message: "Cette fonction n'est pas encore disponible avec l'API actuelle.",
  } satisfies ApiError);

let typeNames: Promise<Map<string, string>> | null = null;
function loadTypeNames(): Promise<Map<string, string>> {
  typeNames ??= raw<{ types: CertificateType[] }>(
    "GET",
    "/admin-certificates/types",
    undefined,
    false,
  )
    .then((r) => new Map(r.types.map((t) => [t.id, t.name])))
    .catch((e) => {
      typeNames = null;
      throw e;
    });
  return typeNames;
}

const reference = (id: string) => `DK-${id.slice(0, 8).toUpperCase()}`;

async function toSummary(v: NestRequestView): Promise<CertificateRequestSummary> {
  // The type list is only a nicety (display names): without it the id is shown and the request stays reviewable.
  const names = await loadTypeNames().catch(() => new Map<string, string>());
  return {
    id: v.id,
    reference: reference(v.id),
    typeId: v.certificateType,
    typeName: names.get(v.certificateType) ?? v.certificateType,
    // The staff list deliberately carries no personal data: the name appears in the detail only.
    holderName: "—",
    createdAt: v.createdAt,
    amountSats: v.priceSats,
    status: v.status,
  };
}

const TIMELINE: Partial<Record<RequestStatus, { kind: TimelineEvent["kind"]; label: string }>> = {
  accepted: { kind: "recommended", label: "Demande acceptée" },
  needs_info: { kind: "recommended", label: "Complément demandé" },
  awaiting_payment: { kind: "invoice", label: "Facture créée" },
  paid: { kind: "paid", label: "Paiement reçu" },
  issuing: { kind: "paid", label: "Génération du certificat en cours" },
  issued: { kind: "issued", label: "Certificat émis" },
  rejected: { kind: "rejected", label: "Demande refusée" },
};

async function toDetail(v: NestRequestView): Promise<CertificateRequestDetail> {
  const summary = await toSummary(v);
  const submitted = Object.fromEntries(
    Object.entries(v.submittedData ?? {}).map(([k, val]) => [
      k,
      typeof val === "string" ? val : JSON.stringify(val),
    ]),
  );
  // Nest does not keep a per-step history yet: the last transition is dated with `updatedAt`.
  const last = TIMELINE[v.status];
  const timeline: TimelineEvent[] = [
    { kind: "created", label: "Demande déposée", at: v.createdAt },
    ...(last ? [{ ...last, at: v.updatedAt }] : []),
  ];
  return {
    ...summary,
    holderName:
      typeof v.submittedData?.["fullName"] === "string" ? v.submittedData["fullName"] : "—",
    submittedData: submitted,
    certificateId: v.certificateId,
    timeline,
    notes: [],
    rejectionReason: v.status === "rejected" ? (v.decisionReason ?? undefined) : undefined,
    infoRequest: v.status === "needs_info" ? (v.decisionReason ?? undefined) : undefined,
  };
}

/** Nest roles -> console roles: one agent verifies AND decides (the server signs after payment). */
const rolesFromNest = (roles: string[]): OrgRole[] =>
  roles.includes("issuer") || roles.includes("admin") ? ["registrar", "approver"] : [];

async function realMe(): Promise<Me> {
  const { user } = await raw<{
    user: {
      id: string;
      email: string | null;
      displayName: string | null;
      organizationId: string | null;
      organizationName: string | null;
      roles: string[];
    };
  }>("GET", "/auth/me");
  return {
    id: user.id,
    name: user.displayName ?? user.email ?? "Agent",
    email: user.email ?? "",
    roles: rolesFromNest(user.roles),
    organization: { id: user.organizationId ?? "", name: user.organizationName ?? "Organisation" },
  };
}

const ORG = "/admin-certificates/organization/requests";
const KYC_REVIEW = "/kyc/review";

/** Fetches a KYC document with the bearer token and returns a blob URL (the caller revokes it). */
async function rawKycDocument(id: string, kind: KycDocumentKind): Promise<string> {
  const res = await fetch(`${BASE}${KYC_REVIEW}/${id}/documents/${kind}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    cache: "no-store",
  });
  if (!res.ok) {
    let err: ApiError = { statusCode: res.status, message: res.statusText };
    try {
      err = (await res.json()) as ApiError;
    } catch {
      /* keep default */
    }
    throw err;
  }
  return URL.createObjectURL(await res.blob());
}

export const api = {
  async login(email: string, password: string) {
    const res = USE_MOCKS
      ? await mocks.mockLogin(email, password)
      : await raw<LoginResponse>("POST", "/auth/login", { email, password }, false);
    tokens.set(res);
  },
  async resume(): Promise<boolean> {
    return tryRefresh();
  },
  async logout() {
    try {
      if (!USE_MOCKS) await raw("POST", "/auth/logout", { refreshToken: tokens.refresh() });
    } finally {
      tokens.clear();
    }
  },
  /** Dev only: impersonate a mock user. */
  impersonate(userId: string) {
    tokens.set(mocks.mockIssueTokens(userId));
  },
  me: () => withRefresh(() => (USE_MOCKS ? mocks.mockMe(accessToken) : realMe())),
  types: () =>
    withRefresh(() =>
      USE_MOCKS
        ? mocks.mockTypes()
        : raw<{ types: CertificateType[] }>("GET", "/admin-certificates/types"),
    ),
  listRequests: (f: RequestFilters) =>
    withRefresh(() =>
      USE_MOCKS
        ? mocks.mockListRequests(accessToken, f)
        : (async (): Promise<Paginated<CertificateRequestSummary>> => {
            const page = f.page ?? 1;
            const status = f.status && f.status !== "all" ? f.status : undefined;
            const res = await raw<{ requests: NestRequestView[]; total: number }>(
              "GET",
              `${ORG}${qs({ status, limit: REAL_PAGE_SIZE, offset: (page - 1) * REAL_PAGE_SIZE })}`,
            );
            return {
              items: await Promise.all(res.requests.map(toSummary)),
              total: res.total,
              page,
              pageSize: REAL_PAGE_SIZE,
            };
          })(),
    ),
  paidCount: () =>
    withRefresh(async () =>
      USE_MOCKS
        ? mocks.mockPaidCount(accessToken)
        : // Real flow: what waits for an agent is a request to verify (`pending`), not a paid one.
          (await raw<{ total: number }>("GET", `${ORG}${qs({ status: "pending", limit: 1 })}`))
            .total,
    ),
  getRequest: (id: string) =>
    withRefresh(() =>
      USE_MOCKS
        ? mocks.mockGetRequest(accessToken, id)
        : raw<{ request: NestRequestView }>("GET", `${ORG}/${id}`).then((r) => toDetail(r.request)),
    ),
  addNote: (id: string, body: string) =>
    withRefresh(() =>
      USE_MOCKS ? mocks.mockAddNote(accessToken, id, body) : unavailable<unknown>(),
    ),
  recommend: (id: string, decision: "issue" | "reject", reason?: string) =>
    withRefresh(() =>
      USE_MOCKS ? mocks.mockRecommend(accessToken, id, decision, reason) : unavailable<unknown>(),
    ),
  issue: (id: string) =>
    withRefresh(
      () => (USE_MOCKS ? mocks.mockIssue(accessToken, id) : unavailable<IssueResult>()), // generated by the server once the payment is confirmed
    ),
  accept: (id: string) =>
    withRefresh(() => (USE_MOCKS ? unavailable<unknown>() : raw("POST", `${ORG}/${id}/accept`))),
  requestInfo: (id: string, message: string) =>
    withRefresh(() =>
      USE_MOCKS ? unavailable<unknown>() : raw("POST", `${ORG}/${id}/request-info`, { message }),
    ),
  reject: (id: string, reason: string) =>
    withRefresh(() =>
      USE_MOCKS
        ? mocks.mockReject(accessToken, id, reason)
        : raw("POST", `${ORG}/${id}/reject`, { reason }),
    ),
  listCertificates: (f: CertificateFilters) =>
    withRefresh(() =>
      USE_MOCKS
        ? mocks.mockListCertificates(accessToken, f)
        : unavailable<Paginated<Certificate>>(),
    ),
  getCertificate: (id: string) =>
    withRefresh(() =>
      USE_MOCKS ? mocks.mockGetCertificate(accessToken, id) : unavailable<Certificate>(),
    ),
  verifyCertificate: (id: string, documentHash?: string) =>
    withRefresh(() =>
      USE_MOCKS
        ? mocks.mockVerify(accessToken, id, documentHash)
        : raw<VerifyResult>(
            "POST",
            `/admin-certificates/${id}/verify`,
            documentHash ? { documentHash } : {},
          ),
    ),
  revokeCertificate: (id: string, reason: string) =>
    withRefresh(() =>
      USE_MOCKS ? mocks.mockRevoke(accessToken, id, reason) : unavailable<unknown>(),
    ),
  listKycReviews: (f: KycReviewFilters) =>
    withRefresh(() =>
      USE_MOCKS
        ? kycMocks.mockListKycReviews(accessToken, f)
        : raw<Paginated<KycReviewDetail>>(
            "GET",
            `${KYC_REVIEW}${qs({
              status: f.status && f.status !== "all" ? f.status : undefined,
              origin: f.origin && f.origin !== "all" ? f.origin : undefined,
              limit: REAL_PAGE_SIZE,
              offset: ((f.page ?? 1) - 1) * REAL_PAGE_SIZE,
            })}`,
          ),
    ),
  getKycReview: (id: string) =>
    withRefresh(() =>
      USE_MOCKS
        ? kycMocks.mockGetKycReview(accessToken, id)
        : raw<KycReviewDetail>("GET", `${KYC_REVIEW}/${id}`),
    ),
  /** Image URL for one document: a blob URL in real mode, a data URL with mocks. */
  getKycDocument: (id: string, kind: KycDocumentKind) =>
    withRefresh(() =>
      USE_MOCKS ? kycMocks.mockKycDocument(accessToken, id, kind) : rawKycDocument(id, kind),
    ),
  decideKycReview: (id: string, decision: KycReviewDecision, note: string) =>
    withRefresh(() =>
      USE_MOCKS
        ? kycMocks.mockDecideKycReview(accessToken, id, decision, note)
        : raw<{ id: string; status: string }>("POST", `${KYC_REVIEW}/${id}/decision`, {
            decision,
            note,
          }),
    ),
  stats: () =>
    withRefresh(() => (USE_MOCKS ? mocks.mockStats(accessToken) : unavailable<DashboardStats>())),
  audit: (f: AuditFilters) =>
    withRefresh(() =>
      USE_MOCKS
        ? mocks.mockAudit(accessToken, f)
        : unavailable<Paginated<AuditEntry> & { actors: string[] }>(),
    ),
  auditExport: (f: AuditFilters) =>
    withRefresh(() =>
      USE_MOCKS ? mocks.mockAuditExport(accessToken, f) : unavailable<AuditEntry[]>(),
    ),
};
