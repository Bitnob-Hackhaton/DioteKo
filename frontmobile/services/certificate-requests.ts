import type {
  CertificateRequestFilter,
  CertificateRequestStatus,
  CertificateRequestView,
  CertificateTypeInfo,
  CertificateValidity,
} from '@/services/api';

// Libelles d'affichage des types (le catalogue et les prix viennent du serveur : `getCertificateTypes`).
export const CERTIFICATE_LABELS: Record<string, { title: string; description: string }> = {
  birth: { title: 'Extrait de naissance', description: 'Document officiel de naissance' },
  marriage: { title: 'Extrait de mariage', description: 'Acte de mariage officiel' },
  death: { title: 'Extrait de décès', description: 'Acte de décès officiel' },
  residence: { title: 'Certificat de résidence', description: 'Attestation de domicile' },
  identity: { title: "Certificat d'identité", description: "Document d'identité officiel" },
};

// Libelles d'affichage des ecrans (accueil, listes, detail). Le filtrage est fait par le serveur
// (`GET /admin-certificates/requests?status=...&validity=...`) ; ce module ne fait que traduire.
export type CertificateUiStatus = 'Valid' | 'Pending' | 'Refused' | 'Expiring Soon' | 'Expired' | 'Revoked';

export type CertificateFilter = 'All' | 'Valid' | 'Pending' | 'Expiring Soon' | 'Expired' | 'Refused';

export const CERTIFICATE_FILTERS: CertificateFilter[] = ['All', 'Valid', 'Pending', 'Expiring Soon', 'Expired', 'Refused'];

// Libelles des puces de filtre (les valeurs internes ci-dessus restent stables).
export const FILTER_LABELS: Record<CertificateFilter, string> = {
  All: 'Toutes',
  Valid: 'Valides',
  Pending: 'En cours',
  'Expiring Soon': 'Expirent bientôt',
  Expired: 'Expirées',
  Refused: 'Refusées',
};

// Traduction filtre d'ecran -> parametres du serveur. "Pending" regroupe toutes les etapes avant l'emission.
const FILTER_PARAMS: Record<CertificateFilter, CertificateRequestFilter> = {
  All: {},
  Valid: { status: ['issued'], validity: 'valid' },
  Pending: { status: ['pending', 'accepted', 'needs_info', 'awaiting_payment', 'paid', 'issuing'] },
  'Expiring Soon': { status: ['issued'], validity: 'expiring_soon' },
  Expired: { status: ['issued'], validity: 'expired' },
  Refused: { status: ['rejected'] },
};

export const filterToParams = (filter: CertificateFilter): CertificateRequestFilter => FILTER_PARAMS[filter];

export const toUiStatus = (
  status: CertificateRequestStatus,
  validity: CertificateValidity | null
): CertificateUiStatus => {
  if (status === 'rejected') return 'Refused';
  if (status === 'issued') {
    switch (validity) {
      case 'expiring_soon':
        return 'Expiring Soon';
      case 'expired':
        return 'Expired';
      case 'revoked':
        return 'Revoked';
      default:
        return 'Valid';
    }
  }
  return 'Pending';
};

// Libelle precis pour l'utilisateur : "Pending" seul ne dit pas s'il doit payer ou attendre l'issuer.
const STATUS_DETAIL: Record<CertificateRequestStatus, string> = {
  pending: 'À vérifier par l\'organisation',
  accepted: 'Acceptée, à payer',
  needs_info: 'Complément demandé',
  awaiting_payment: 'Paiement en attente',
  paid: 'Payée, génération en cours',
  issuing: 'Génération du certificat',
  issued: 'Certificat émis',
  rejected: 'Demande refusée',
};

const VALIDITY_DETAIL: Partial<Record<CertificateValidity, string>> = {
  expiring_soon: 'Certificat émis, expire bientôt',
  expired: 'Certificat expiré',
  revoked: 'Certificat révoqué',
};

export const statusDetail = (status: CertificateRequestStatus, validity: CertificateValidity | null = null): string =>
  (status === 'issued' && validity ? VALIDITY_DETAIL[validity] : undefined) ?? STATUS_DETAIL[status] ?? status;

// Avancement : `currentStep` = nombre d'etapes terminees (meme convention que le composant Timeline).
const TIMELINE_STEPS = [
  { title: 'Demande', description: 'Votre demande est enregistrée.' },
  { title: 'Vérification', description: "L'organisation vérifie votre demande." },
  { title: 'Paiement', description: 'Règlement Lightning de la demande.' },
  { title: 'Certificat', description: 'Le certificat est généré puis remis dans votre application.' },
];

const COMPLETED_STEPS: Record<CertificateRequestStatus, number> = {
  pending: 1,
  needs_info: 1,
  accepted: 2,
  awaiting_payment: 2,
  paid: 3,
  issuing: 3,
  issued: 4,
  rejected: 1,
};

export const buildTimeline = (status: CertificateRequestStatus) => ({
  steps: TIMELINE_STEPS,
  currentStep: COMPLETED_STEPS[status] ?? 1,
});

export const typeNameById = (types: CertificateTypeInfo[]): Map<string, string> =>
  new Map(types.map((type) => [type.id, type.name]));

export const displayName = (request: Pick<CertificateRequestView, 'certificateType'>, names: Map<string, string>) =>
  names.get(request.certificateType) ?? request.certificateType;

export const formatDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
};

// Lien encode dans le QR du certificat : meme format que celui emis par le backend (voir `extractCertificateId`).
export const verificationLink = (certificateId: string) =>
  `dioteko://verify?certificateId=${encodeURIComponent(certificateId)}`;
