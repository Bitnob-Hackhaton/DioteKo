import type {
  CertificateRequestDetail,
  CertificateRequestSummary,
  CertificateType,
  IssueResult,
  LoginResponse,
  Me,
  Paginated,
  RequestFilters,
  ApiError,
} from "./types";
import { can, violatesFourEyes } from "./permissions";

const LATENCY = 400;
const wait = () => new Promise((r) => setTimeout(r, LATENCY));
const fail = (statusCode: number, message: string): never => {
  throw { statusCode, message } satisfies ApiError;
};

const ORG = { id: "org-dkr", name: "Mairie de Dakar-Plateau" };

export const MOCK_USERS: Me[] = [
  {
    id: "u-owner",
    name: "Aminata Sow",
    email: "aminata.sow@mairie-plateau.sn",
    roles: ["org_owner"],
    organization: ORG,
  },
  {
    id: "u-reg",
    name: "Ibrahima Ndiaye",
    email: "ibrahima.ndiaye@mairie-plateau.sn",
    roles: ["registrar"],
    organization: ORG,
  },
  {
    id: "u-appr",
    name: "Fatou Diop",
    email: "fatou.diop@mairie-plateau.sn",
    roles: ["approver"],
    organization: ORG,
  },
  {
    id: "u-dual",
    name: "Moussa Faye",
    email: "moussa.faye@mairie-plateau.sn",
    roles: ["registrar", "approver"],
    organization: ORG,
  },
  {
    id: "u-fin",
    name: "Awa Ba",
    email: "awa.ba@mairie-plateau.sn",
    roles: ["finance_officer"],
    organization: ORG,
  },
  {
    id: "u-aud",
    name: "Cheikh Gueye",
    email: "cheikh.gueye@mairie-plateau.sn",
    roles: ["auditor"],
    organization: ORG,
  },
  {
    id: "u-admin",
    name: "Équipe DioteKo",
    email: "admin@dioteko.sn",
    roles: [],
    platformRole: "super_admin",
    organization: ORG,
  },
  {
    id: "u-holder",
    name: "Citoyen test",
    email: "citoyen@exemple.sn",
    roles: [],
    organization: ORG,
  },
];

export const MOCK_TYPES: CertificateType[] = [
  { id: "birth", name: "Extrait d'acte de naissance", priceSats: 2500 },
  { id: "marriage", name: "Certificat de mariage", priceSats: 5000 },
  { id: "death", name: "Acte de décès", priceSats: 2500 },
  { id: "residence", name: "Certificat de résidence", priceSats: 3500 },
  { id: "identity", name: "Certificat d'identité", priceSats: 12500 },
];

const FIRST = [
  "Mamadou",
  "Aïssatou",
  "Ousmane",
  "Mariama",
  "Abdoulaye",
  "Khady",
  "Babacar",
  "Ndeye",
  "Serigne",
  "Coumba",
  "Pape",
  "Rokhaya",
  "Alioune",
  "Seynabou",
  "Lamine",
];
const LAST = [
  "Diallo",
  "Sarr",
  "Fall",
  "Mbaye",
  "Cissé",
  "Kane",
  "Thiam",
  "Seck",
  "Ly",
  "Niang",
  "Touré",
  "Camara",
];
const STATUSES = [
  "paid",
  "paid",
  "paid",
  "awaiting_payment",
  "issued",
  "issued",
  "rejected",
  "pending",
  "paid",
  "issued",
] as const;

const hex = (seed: number, len = 64) => {
  let s = "";
  let x = seed * 2654435761;
  while (s.length < len) {
    x = (x * 1103515245 + 12345) % 2147483648;
    s += x.toString(16).padStart(8, "0");
  }
  return s.slice(0, len);
};

function build(): CertificateRequestDetail[] {
  const now = Date.now();
  return Array.from({ length: 64 }, (_, i) => {
    const type = MOCK_TYPES[i % MOCK_TYPES.length]!;
    const status = STATUSES[i % STATUSES.length]!;
    const holder = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    const created = new Date(now - (i * 5.3 + 1) * 3600_000).toISOString();
    const invoice = new Date(new Date(created).getTime() + 60_000).toISOString();
    const paid = new Date(new Date(created).getTime() + 9 * 60_000).toISOString();
    const timeline: CertificateRequestDetail["timeline"] = [
      { kind: "created", label: "Demande créée", at: created },
    ];
    if (status !== "pending")
      timeline.push({ kind: "invoice", label: "Facture Lightning créée", at: invoice });
    const isPaid = status === "paid" || status === "issued" || status === "rejected";
    if (isPaid) timeline.push({ kind: "paid", label: "Paiement reçu", at: paid });
    const submittedData: Record<string, string> = {
      "Nom complet": holder,
      "Date de naissance": `${String((i % 27) + 1).padStart(2, "0")}/0${(i % 9) + 1}/19${70 + (i % 30)}`,
      "Lieu de naissance": ["Dakar", "Thiès", "Saint-Louis", "Kaolack", "Ziguinchor"][i % 5]!,
      "Nom du père": `${FIRST[(i + 3) % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
      "Nom de la mère": `${FIRST[(i + 5) % FIRST.length]} ${LAST[(i + 2) % LAST.length]}`,
      "Numéro de registre": `${2000 + (i % 25)}/${1000 + i * 13}`,
      Téléphone: `+221 77 ${String(100 + i).slice(-3)} ${String(10 + i).slice(-2)} ${String(40 + i).slice(-2)}`,
    };
    const d: CertificateRequestDetail = {
      id: `req-${String(i + 1).padStart(4, "0")}`,
      reference: `DK-2026-${String(4821 - i).padStart(6, "0")}`,
      typeId: type.id,
      typeName: type.name,
      holderName: holder,
      createdAt: created,
      amountSats: type.priceSats,
      status,
      paidAt: isPaid ? paid : undefined,
      paymentHash: isPaid ? hex(i + 1) : undefined,
      submittedData,
      timeline,
      notes: [],
    };
    if (status === "paid" && i % 3 === 0) {
      const at = new Date(new Date(paid).getTime() + 30 * 60_000).toISOString();
      d.recommendation = { decision: "issue", byId: "u-reg", byName: "Ibrahima Ndiaye", at };
      d.timeline.push({
        kind: "recommended",
        label: "Recommandée pour émission",
        at,
        actor: "Ibrahima Ndiaye",
      });
      d.notes.push({
        id: `n-${i}`,
        authorName: "Ibrahima Ndiaye",
        authorRole: "registrar",
        body: "Données conformes au registre.",
        at,
      });
    }
    if (status === "paid" && i % 4 === 1) {
      const at = new Date(new Date(paid).getTime() + 20 * 60_000).toISOString();
      d.recommendation = { decision: "issue", byId: "u-dual", byName: "Moussa Faye", at };
      d.timeline.push({
        kind: "recommended",
        label: "Recommandée pour émission",
        at,
        actor: "Moussa Faye",
      });
    }
    if (status === "issued") {
      const at = new Date(new Date(paid).getTime() + 3 * 3600_000).toISOString();
      d.timeline.push({ kind: "issued", label: "Certificat émis", at, actor: "Fatou Diop" });
      d.issued = issueResult(d, at);
    }
    if (status === "rejected") {
      const at = new Date(new Date(paid).getTime() + 2 * 3600_000).toISOString();
      d.rejectionReason = "Numéro de registre introuvable dans les archives.";
      d.timeline.push({ kind: "rejected", label: "Demande refusée", at, actor: "Fatou Diop" });
    }
    return d;
  });
}

function issueResult(d: CertificateRequestDetail, at: string): IssueResult {
  const n = Number(d.id.slice(4));
  const valid = new Date(at);
  valid.setFullYear(valid.getFullYear() + 1);
  return {
    certificateId: `CERT-${d.reference.slice(3)}`,
    documentHash: hex(n * 31),
    blockchainAnchor: { txId: "simulated", network: "simulé", timestamp: at, blockHeight: null },
    validUntil: valid.toISOString(),
    qrCodeData: `https://verify.dioteko.sn/c/${d.id}`,
  };
}

let DB = build();
const inFlight = new Set<string>();

export function resetMockDb() {
  DB = build();
}

const summary = ({
  submittedData: _s,
  timeline: _t,
  notes: _n,
  recommendation: _r,
  issued: _i,
  paymentHash: _p,
  rejectionReason: _x,
  ...rest
}: CertificateRequestDetail): CertificateRequestSummary => rest;

// ---- Auth ----
const tokens = new Map<string, string>(); // token -> userId

export async function mockLogin(email: string, password: string): Promise<LoginResponse> {
  await wait();
  const u = MOCK_USERS.find((m) => m.email.toLowerCase() === email.trim().toLowerCase());
  if (!u || password !== "demo") fail(401, "Identifiants invalides.");
  return mockIssueTokens(u!.id);
}

export function mockIssueTokens(userId: string): LoginResponse {
  const accessToken = `mock-at-${userId}-${Math.random().toString(36).slice(2)}`;
  const refreshToken = `mock-rt-${userId}-${Math.random().toString(36).slice(2)}`;
  tokens.set(accessToken, userId);
  tokens.set(refreshToken, userId);
  return { accessToken, refreshToken, expiresIn: 900 };
}

export async function mockRefresh(refreshToken: string): Promise<LoginResponse> {
  await wait();
  const m = /^mock-rt-(u-[a-z]+)-/.exec(refreshToken);
  if (!m) fail(401, "Session expirée.");
  return mockIssueTokens(m![1]!);
}

function userFromToken(token: string | null): Me {
  const id = token ? tokens.get(token) : undefined;
  const u = MOCK_USERS.find((m) => m.id === id);
  if (!u) fail(401, "Session expirée.");
  return u!;
}

export async function mockMe(token: string | null): Promise<Me> {
  await wait();
  return userFromToken(token);
}

// ---- Requests ----
export async function mockTypes(): Promise<{ types: CertificateType[] }> {
  await wait();
  return { types: MOCK_TYPES };
}

export async function mockListRequests(
  token: string | null,
  f: RequestFilters,
): Promise<Paginated<CertificateRequestSummary>> {
  await wait();
  const u = userFromToken(token);
  if (!can(u, "request.view")) fail(403, "Accès refusé : permission request.view requise.");
  const status = f.status ?? "paid";
  const q = f.q?.trim().toLowerCase();
  let rows = DB.filter((r) => (status === "all" ? true : r.status === status))
    .filter((r) => (f.type ? r.typeId === f.type : true))
    .filter((r) =>
      q ? `${r.reference} ${r.holderName} ${r.paymentHash ?? ""}`.toLowerCase().includes(q) : true,
    )
    .filter((r) => (f.from ? r.createdAt >= f.from : true))
    .filter((r) => (f.to ? r.createdAt.slice(0, 10) <= f.to : true));
  // paid requests: oldest first (queue); others newest first
  rows = [...rows].sort((a, b) =>
    status === "paid"
      ? a.createdAt.localeCompare(b.createdAt)
      : b.createdAt.localeCompare(a.createdAt),
  );
  const page = Math.max(1, f.page ?? 1);
  const pageSize = 25;
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize).map(summary),
    total: rows.length,
    page,
    pageSize,
  };
}

export async function mockPaidCount(token: string | null): Promise<number> {
  await wait();
  userFromToken(token);
  return DB.filter((r) => r.status === "paid").length;
}

function find(id: string) {
  const r = DB.find((x) => x.id === id);
  if (!r) fail(404, "Demande introuvable.");
  return r!;
}

export async function mockGetRequest(
  token: string | null,
  id: string,
): Promise<CertificateRequestDetail> {
  await wait();
  const u = userFromToken(token);
  if (!can(u, "request.view")) fail(403, "Accès refusé.");
  return structuredClone(find(id));
}

export async function mockAddNote(token: string | null, id: string, body: string) {
  await wait();
  const u = userFromToken(token);
  if (!can(u, "request.note"))
    fail(
      403,
      "Accès refusé : seul un agent d'état civil ou un officier signataire peut ajouter une note.",
    );
  const r = find(id);
  r.notes.push({
    id: `n-${Date.now()}`,
    authorName: u.name,
    authorRole: u.roles.includes("registrar") ? "registrar" : "approver",
    body,
    at: new Date().toISOString(),
  });
  audit(u, "Note ajoutée", r.reference);
  return { ok: true };
}

export async function mockRecommend(
  token: string | null,
  id: string,
  decision: "issue" | "reject",
  reason?: string,
) {
  await wait();
  const u = userFromToken(token);
  if (!can(u, "request.recommend"))
    fail(403, "Accès refusé : recommandation réservée aux agents d'état civil.");
  const r = find(id);
  if (r.status !== "paid") fail(409, "Seule une demande payée peut être recommandée.");
  const at = new Date().toISOString();
  r.recommendation = { decision, reason, byId: u.id, byName: u.name, at };
  r.timeline = r.timeline.filter((t) => t.kind !== "recommended");
  r.timeline.push({
    kind: "recommended",
    label: decision === "issue" ? "Recommandée pour émission" : "Recommandée pour refus",
    at,
    actor: u.name,
  });
  audit(u, decision === "issue" ? "Émission recommandée" : "Refus recommandé", r.reference);
  return { ok: true };
}

export async function mockIssue(token: string | null, id: string): Promise<IssueResult> {
  if (inFlight.has(id)) fail(409, "Émission déjà en cours pour cette demande.");
  inFlight.add(id);
  try {
    await wait();
    const u = userFromToken(token);
    if (!can(u, "request.issue"))
      fail(403, "Accès refusé : émission réservée aux officiers signataires.");
    const r = find(id);
    if (r.status !== "paid") fail(409, "Cette demande n'est plus en attente de traitement.");
    if (violatesFourEyes(u.id, r.recommendation?.byId))
      fail(
        403,
        "Règle des quatre yeux : vous ne pouvez pas valider une demande que vous avez recommandée.",
      );
    const at = new Date().toISOString();
    r.status = "issued";
    r.issued = issueResult(r, at);
    r.timeline.push({ kind: "issued", label: "Certificat émis", at, actor: u.name });
    audit(u, "Certificat émis", `${r.issued.certificateId} (${r.reference})`);
    return r.issued;
  } finally {
    inFlight.delete(id);
  }
}

export async function mockReject(token: string | null, id: string, reason: string) {
  await wait();
  const u = userFromToken(token);
  if (!can(u, "request.reject"))
    fail(403, "Accès refusé : refus réservé aux officiers signataires.");
  if (reason.trim().length < 10) fail(400, "Le motif doit contenir au moins 10 caractères.");
  const r = find(id);
  if (r.status !== "paid") fail(409, "Cette demande n'est plus en attente de traitement.");
  if (violatesFourEyes(u.id, r.recommendation?.byId))
    fail(
      403,
      "Règle des quatre yeux : vous ne pouvez pas valider une demande que vous avez recommandée.",
    );
  const at = new Date().toISOString();
  r.status = "rejected";
  r.rejectionReason = reason.trim();
  r.timeline.push({ kind: "rejected", label: "Demande refusée", at, actor: u.name });
  audit(u, "Demande refusée", r.reference);
  return { ok: true };
}

// ---- Certificates ----
import type { Certificate, CertificateFilters, VerifyResult } from "./types";

const revocations = new Map<string, { reason: string; byName: string; at: string }>();

function toCertificate(r: CertificateRequestDetail, idx: number): Certificate {
  const issuedEvt = r.timeline.find((t) => t.kind === "issued");
  const issued = r.issued!;
  // every 7th certificate is shown as already expired to exercise that state
  const validUntil =
    idx % 7 === 3 ? new Date(Date.now() - 5 * 86400_000).toISOString() : issued.validUntil;
  const rev = revocations.get(issued.certificateId);
  return {
    id: issued.certificateId,
    requestId: r.id,
    reference: r.reference,
    typeId: r.typeId,
    typeName: r.typeName,
    holderName: r.holderName,
    issuedAt: issuedEvt?.at ?? issued.blockchainAnchor.timestamp,
    validUntil,
    status: rev ? "revoked" : validUntil < new Date().toISOString() ? "expired" : "valid",
    documentHash: issued.documentHash,
    anchor: issued.blockchainAnchor,
    issuedBy: issuedEvt?.actor,
    revocation: rev,
  };
}

function allCerts(): Certificate[] {
  return DB.filter((r) => r.status === "issued" && r.issued)
    .map(toCertificate)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

export async function mockListCertificates(
  token: string | null,
  f: CertificateFilters,
): Promise<Paginated<Certificate>> {
  await wait();
  const u = userFromToken(token);
  if (!can(u, "certificate.view")) fail(403, "Accès refusé.");
  const q = f.q?.trim().toLowerCase();
  const rows = allCerts()
    .filter((c) => (!f.status || f.status === "all" ? true : c.status === f.status))
    .filter((c) => (f.type ? c.typeId === f.type : true))
    .filter((c) =>
      q
        ? `${c.id} ${c.reference} ${c.holderName} ${c.documentHash}`.toLowerCase().includes(q)
        : true,
    );
  const page = Math.max(1, f.page ?? 1);
  return { items: rows.slice((page - 1) * 25, page * 25), total: rows.length, page, pageSize: 25 };
}

export async function mockGetCertificate(token: string | null, id: string): Promise<Certificate> {
  await wait();
  userFromToken(token);
  const c = allCerts().find((x) => x.id === id);
  if (!c) fail(404, "Certificat introuvable.");
  return c!;
}

export async function mockVerify(
  token: string | null,
  id: string,
  documentHash?: string,
): Promise<VerifyResult> {
  await wait();
  const c = await mockGetCertificate(token, id);
  const base = { certificateType: c.typeName, issuedAt: c.issuedAt, expiresAt: c.validUntil };
  if (documentHash && documentHash.trim().toLowerCase() !== c.documentHash)
    return { ...base, valid: false, reason: "Le hash fourni ne correspond pas au document émis." };
  if (c.status === "revoked")
    return { ...base, valid: false, reason: `Certificat révoqué : ${c.revocation?.reason}` };
  if (c.status === "expired") return { ...base, valid: false, reason: "Certificat expiré." };
  return { ...base, valid: true };
}

export async function mockRevoke(token: string | null, id: string, reason: string) {
  await wait();
  const u = userFromToken(token);
  if (!can(u, "certificate.revoke"))
    fail(403, "Accès refusé : révocation réservée aux officiers signataires.");
  if (reason.trim().length < 10) fail(400, "Le motif doit contenir au moins 10 caractères.");
  const c = allCerts().find((x) => x.id === id);
  if (!c) fail(404, "Certificat introuvable.");
  if (c!.status === "revoked") fail(409, "Ce certificat est déjà révoqué.");
  revocations.set(id, { reason: reason.trim(), byName: u.name, at: new Date().toISOString() });
  audit(u, "Certificat révoqué", id);
  return { ok: true };
}

// ---- Dashboard & audit ----
import type { AuditEntry, AuditFilters, DashboardStats } from "./types";
import { actorsOf, ROLE_LABELS } from "./permissions";

const AUDIT: AuditEntry[] = (() => {
  const now = Date.now();
  const acts: [string, string, (i: number) => string][] = [
    ["u-reg", "Émission recommandée", (i) => `DK-2026-${String(4800 - i).padStart(6, "0")}`],
    ["u-appr", "Certificat émis", (i) => `CERT-2026-${String(4790 - i).padStart(6, "0")}`],
    ["u-fin", "Versement préparé", (i) => `PAY-${1200 + i}`],
    ["u-owner", "Membre invité", () => "khadija.sy@mairie-plateau.sn"],
    ["u-aud", "Export CSV du journal", () => "Journal d'audit"],
    ["u-appr", "Demande refusée", (i) => `DK-2026-${String(4700 - i).padStart(6, "0")}`],
    ["u-reg", "Connexion", () => "Session"],
  ];
  return Array.from({ length: 140 }, (_, i) => {
    const [uid, action, obj] = acts[i % acts.length]!;
    const u = MOCK_USERS.find((m) => m.id === uid)!;
    return {
      id: `a-${i}`,
      at: new Date(now - (i * 3.7 + 0.5) * 3600_000).toISOString(),
      actorName: u.name,
      actorRole: actorsOf(u)
        .map((r) => ROLE_LABELS[r])
        .join(" + "),
      action,
      object: obj(i),
    };
  });
})();

function audit(u: Me, action: string, object: string) {
  AUDIT.unshift({
    id: `a-${Date.now()}`,
    at: new Date().toISOString(),
    actorName: u.name,
    actorRole: actorsOf(u)
      .map((r) => ROLE_LABELS[r])
      .join(" + "),
    action,
    object,
  });
}

export async function mockStats(token: string | null): Promise<DashboardStats> {
  await wait();
  const u = userFromToken(token);
  if (!can(u, "dashboard.view")) fail(403, "Accès refusé.");
  const now = Date.now();
  const since = new Date(now - 30 * 86400_000).toISOString();
  const recent = DB.filter((r) => r.createdAt >= since);
  const issued = DB.filter((r) => r.status === "issued");
  const delays = issued
    .map((r) => {
      const ev = r.timeline.find((t) => t.kind === "issued");
      return ev && r.paidAt
        ? (new Date(ev.at).getTime() - new Date(r.paidAt).getTime()) / 60000
        : null;
    })
    .filter((d): d is number => d !== null);
  const series = Array.from({ length: 30 }, (_, k) => {
    const d = new Date(now - (29 - k) * 86400_000).toISOString().slice(0, 10);
    const day = DB.filter((r) => r.createdAt.slice(0, 10) === d);
    const c = (s: string) => day.filter((r) => r.status === s).length;
    return {
      date: d,
      awaiting_payment: c("awaiting_payment"),
      paid: c("paid"),
      issued: c("issued"),
      rejected: c("rejected"),
    };
  });
  return {
    paidToProcess: DB.filter((r) => r.status === "paid").length,
    issued30d: issued.filter(
      (r) => (r.timeline.find((t) => t.kind === "issued")?.at ?? "") >= since,
    ).length,
    satsCollected30d: recent.filter((r) => r.paidAt).reduce((a, r) => a + (r.amountSats ?? 0), 0),
    avgDelayMinutes: delays.length
      ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length)
      : null,
    series,
    oldestPaid: DB.filter((r) => r.status === "paid")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, 5)
      .map(summary),
  };
}

function filterAudit(f: AuditFilters) {
  return AUDIT.filter((a) => (f.actor ? a.actorName === f.actor : true))
    .filter((a) => (f.from ? a.at.slice(0, 10) >= f.from : true))
    .filter((a) => (f.to ? a.at.slice(0, 10) <= f.to : true));
}

export async function mockAudit(
  token: string | null,
  f: AuditFilters,
): Promise<Paginated<AuditEntry> & { actors: string[] }> {
  await wait();
  const u = userFromToken(token);
  if (!can(u, "audit.view"))
    fail(403, "Accès refusé : journal réservé au propriétaire et aux auditeurs.");
  const rows = filterAudit(f);
  const page = Math.max(1, f.page ?? 1);
  return {
    items: rows.slice((page - 1) * 50, page * 50),
    total: rows.length,
    page,
    pageSize: 50,
    actors: [...new Set(AUDIT.map((a) => a.actorName))].sort(),
  };
}

export async function mockAuditExport(
  token: string | null,
  f: AuditFilters,
): Promise<AuditEntry[]> {
  await wait();
  const u = userFromToken(token);
  if (!can(u, "audit.export")) fail(403, "Accès refusé.");
  audit(u, "Export CSV du journal", "Journal d'audit");
  return filterAudit(f);
}
