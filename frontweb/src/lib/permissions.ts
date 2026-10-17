import type { Me, OrgRole } from "./types";

type Actor = OrgRole | "super_admin";

const ALL_ORG: OrgRole[] = ["org_owner", "registrar", "approver", "finance_officer", "auditor"];

/** Single source of truth for who may do what. */
export const PERMISSIONS = {
  "dashboard.view": [...ALL_ORG, "super_admin"],
  "request.view": [...ALL_ORG, "super_admin"],
  // Données personnelles du citoyen : seulement les rôles qui instruisent la demande.
  "request.view_personal_data": ["registrar", "approver"],
  "request.note": ["registrar", "approver"],
  "request.recommend": ["registrar"],
  "request.issue": ["approver"],
  "request.reject": ["approver"],
  // Relecture manuelle des pièces d'identité (KYC) : mêmes rôles que l'instruction des demandes.
  "kyc.review": ["registrar", "approver"],
  "certificate.view": [...ALL_ORG, "super_admin"],
  "certificate.revoke": ["approver"],
  "payout.view": ["org_owner", "finance_officer", "auditor", "super_admin"],
  "payout.create": ["finance_officer"],
  "payout.reconcile": ["finance_officer"],
  "payout.propose_finalize": ["finance_officer"],
  "payout.confirm_finalize": ["org_owner"],
  "audit.view": ["org_owner", "auditor", "super_admin"],
  "audit.export": ["org_owner", "auditor", "super_admin"],
  "member.view": ["org_owner", "auditor", "super_admin"],
  "member.invite": ["org_owner"],
  "member.change_role": ["org_owner"],
  "member.suspend": ["org_owner"],
  "org.edit": ["org_owner"],
  "org.switch": ["super_admin"],
  "org.create": ["super_admin"],
} as const satisfies Record<string, readonly Actor[]>;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_LABELS: Record<Actor, string> = {
  super_admin: "Super-administrateur DioteKo",
  org_owner: "Propriétaire de l'organisation",
  registrar: "Agent d'état civil",
  approver: "Officier signataire",
  finance_officer: "Agent financier",
  auditor: "Auditeur",
};

export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  org_owner: "Gère l'équipe et l'organisation, confirme les versements. N'émet pas de certificat.",
  registrar: "Vérifie les demandes, ajoute des notes et recommande l'émission ou le refus.",
  approver: "Seul habilité à émettre, refuser définitivement et révoquer un certificat.",
  finance_officer: "Prépare les versements, rapproche et propose la finalisation.",
  auditor: "Consultation seule et export CSV. Aucune action.",
};

export function actorsOf(user: Pick<Me, "roles" | "platformRole"> | null | undefined): Actor[] {
  if (!user) return [];
  return [...user.roles, ...(user.platformRole ? [user.platformRole] : [])];
}

export function can(
  user: Pick<Me, "roles" | "platformRole"> | null | undefined,
  permission: Permission,
): boolean {
  const allowed = PERMISSIONS[permission] as readonly Actor[];
  return actorsOf(user).some((a) => allowed.includes(a));
}

export function rolesFor(permission: Permission): string {
  return (PERMISSIONS[permission] as readonly Actor[]).map((r) => ROLE_LABELS[r]).join(", ");
}

/** Four-eyes rule: the person who recommended may not take the final decision. */
export function violatesFourEyes(userId: string, recommendedById: string | undefined): boolean {
  return !!recommendedById && recommendedById === userId;
}
