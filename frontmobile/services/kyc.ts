import api from '@/services/api';
import { elapsedMs, kycLog, kycWarn } from '@/lib/kyc-log';

// Verification d'identite (KYC) : backend-nest `/kyc/*`. Le serveur est l'autorite (statut relu chez le prestataire) ;
// ce module ne fait que transporter les photos et traduire les statuts.

export type KycStatus = 'not_started' | 'pending' | 'verified' | 'failed' | 'manual_review' | 'rejected';
export type KycDocumentType = 'national_id' | 'passport';
export type KycPhotoStep = 'front' | 'back' | 'selfie';

export interface KycStatusView {
  status: KycStatus;
  sessionId: string | null;
  documentType: KycDocumentType | null;
  attempts: number;
  verifiedAt: string | null;
  // Valeur fixe du serveur (voir KYC_FAILURE_LABELS), jamais un texte libre.
  failureReason: string | null;
  // Vrai quand le dossier est refuse : un nouvel essai est possible (dans la limite quotidienne).
  canRestart: boolean;
  // Photo que le prestataire attend ensuite sur une session ouverte : l'ecran reprend la ou elle s'est arretee.
  nextStep: KycPhotoStep | null;
  // `agent` : les documents finissent chez un agent de l'organisation (relecture manuelle) ; `automatic` sinon.
  reviewMode?: 'automatic' | 'agent';
  // Comment traiter un MRZ illisible : refuser (`strict`), prevenir et laisser envoyer (`warn`), ignorer (`off`).
  mrzPrecheck?: 'strict' | 'warn' | 'off';
}

export const KYC_DOCUMENT_LABELS: Record<KycDocumentType, { title: string; description: string }> = {
  national_id: { title: "Carte nationale d'identité", description: 'Recto et verso, puis un selfie' },
  passport: { title: 'Passeport', description: 'Page photo, puis un selfie' },
};

export const KYC_STATUS_LABELS: Record<KycStatus, string> = {
  not_started: 'Non vérifiée',
  pending: 'En cours',
  verified: 'Vérifiée',
  failed: 'Refusée',
  manual_review: "En cours d'examen",
  rejected: 'Refusée',
};

export const KYC_FAILURE_LABELS: Record<string, string> = {
  document_unreadable: 'La pièce est illisible. Reprenez la photo avec plus de lumière, sans reflet.',
  document_expired: 'La pièce est expirée. Utilisez une pièce en cours de validité.',
  selfie_mismatch: 'Le selfie ne correspond pas à la photo de la pièce.',
  liveness_failed: 'Le selfie n’a pas pu être validé. Prenez-le en direct, visage bien visible.',
  rejected: 'La vérification a été refusée.',
  other: 'La vérification n’a pas abouti.',
};

export const kycFailureMessage = (reason: string | null): string =>
  (reason && KYC_FAILURE_LABELS[reason]) || KYC_FAILURE_LABELS.other;

// Etapes de capture selon le document : la CNI a un verso, le passeport n'a qu'une page.
export const kycStepsFor = (documentType: KycDocumentType): KycPhotoStep[] =>
  documentType === 'national_id' ? ['front', 'back', 'selfie'] : ['front', 'selfie'];

// Le serveur attend l'analyse de la photo chez le prestataire (jusqu'a ~50 s pour un recto pleine resolution, plus la
// relecture du verdict pour le selfie) : ce delai doit rester superieur au sien (150 s, `IDSWYFT_UPLOAD_TIMEOUT_MS`).
const PHOTO_TIMEOUT_MS = 170000;

// Codes d'erreur du serveur (et du client) qui veulent dire « pas de reponse a temps », sans savoir si la photo est
// arrivee : l'ecran relit alors la progression avant d'afficher une erreur.
export const KYC_PROVIDER_TIMEOUT = 'KYC_PROVIDER_TIMEOUT';
export const KYC_PROVIDER_UNREACHABLE = 'KYC_PROVIDER_UNREACHABLE';
const CLIENT_TIMEOUT = 'CLIENT_TIMEOUT';
const CLIENT_NETWORK = 'CLIENT_NETWORK';

const CODE_MESSAGES: Record<string, string> = {
  [KYC_PROVIDER_TIMEOUT]: 'L’analyse prend plus de temps que prévu. Votre photo est peut-être bien arrivée : patientez un instant.',
  [KYC_PROVIDER_UNREACHABLE]: 'Le service de vérification est injoignable. Réessayez dans un instant.',
  [CLIENT_TIMEOUT]: 'Le serveur met trop de temps à répondre. Votre photo est peut-être bien arrivée : patientez un instant.',
  [CLIENT_NETWORK]: 'Connexion perdue. Vérifiez votre réseau puis réessayez.',
};

// Erreur d'API portant le code machine du serveur (ou du client) et le statut HTTP.
export class KycRequestError extends Error {
  readonly code: string | undefined;
  readonly status: number | undefined;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = 'KycRequestError';
    this.code = code;
    this.status = status;
  }
}

const isNoAnswerCode = (code: string | undefined) =>
  code === KYC_PROVIDER_TIMEOUT || code === KYC_PROVIDER_UNREACHABLE || code === CLIENT_TIMEOUT || code === CLIENT_NETWORK;

// Vrai quand on ne sait pas si la photo est arrivee (delai depasse, reseau coupe) : a reconcilier, pas a refuser.
export const isNoAnswerError = (error: unknown): boolean => error instanceof KycRequestError && isNoAnswerCode(error.code);

// Vrai quand la photo etait peut-etre en cours d'analyse (le serveur travaille encore) : on peut attendre.
export const isTimeoutError = (error: unknown): boolean =>
  error instanceof KycRequestError && (error.code === KYC_PROVIDER_TIMEOUT || error.code === CLIENT_TIMEOUT);

const codeOf = (error: unknown): string | undefined => {
  const serverCode = (error as any)?.response?.data?.code;
  if (typeof serverCode === 'string') return serverCode;
  const axiosCode = (error as any)?.code;
  if (axiosCode === 'ECONNABORTED') return CLIENT_TIMEOUT;
  if (axiosCode === 'ERR_NETWORK') return CLIENT_NETWORK;
  return undefined;
};

const messageOf = (error: unknown, fallback: string): string => {
  const code = codeOf(error);
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  const serverMessage = (error as any)?.response?.data?.error;
  if (typeof serverMessage === 'string' && serverMessage) return serverMessage;
  if ((error as any)?.code === 'ECONNABORTED') return 'Le serveur met trop de temps à répondre. Réessayez.';
  if ((error as any)?.response?.status === 413) return 'La photo est trop lourde (5 Mo maximum). Reprenez-la.';
  return error instanceof Error ? error.message : fallback;
};

// GET /kyc/status : meilleur dossier du titulaire ; un dossier en cours est relu chez le prestataire.
export const getKycStatus = async (): Promise<KycStatusView> => {
  const startedAt = Date.now();
  try {
    const response = await api.get('/kyc/status');
    const kyc = (response.data as { kyc: KycStatusView }).kyc;
    kycLog('status', { status: kyc.status, nextStep: kyc.nextStep, ms: elapsedMs(startedAt) });
    return kyc;
  } catch (error) {
    kycWarn('status failed', { code: codeOf(error), ms: elapsedMs(startedAt) });
    throw new Error(messageOf(error, 'Impossible de lire le statut de vérification.'));
  }
};

// POST /kyc/sessions : ouvre (ou reprend) la session. Idempotent cote serveur. `issuingCountry` : code ISO alpha-2
// du pays qui a delivre la piece (ex. `SN`), transmis au prestataire.
export const startKycSession = async (documentType: KycDocumentType, issuingCountry?: string): Promise<KycStatusView> => {
  const startedAt = Date.now();
  try {
    const response = await api.post('/kyc/sessions', { documentType, ...(issuingCountry ? { issuingCountry } : {}) });
    const kyc = (response.data as { kyc: KycStatusView }).kyc;
    kycLog('session started', { documentType, country: issuingCountry, status: kyc.status, nextStep: kyc.nextStep, ms: elapsedMs(startedAt) });
    return kyc;
  } catch (error) {
    kycWarn('session start failed', { code: codeOf(error), ms: elapsedMs(startedAt) });
    throw new Error(messageOf(error, 'Impossible de démarrer la vérification.'));
  }
};

// Resultat du controle prealable d'une photo : `ok`, `no_document` (pas de piece dans l'image), `no_face` (pas de visage)
// ou `skipped` (controle impossible : on envoie la photo normalement).
export type KycPrecheckResult = 'ok' | 'no_document' | 'no_face' | 'mrz_unreadable' | 'skipped';

// POST /kyc/sessions/:id/cancel : ferme la session ouverte pour en recommencer une (autre piece, autre pays).
export const cancelKycSession = async (sessionId: string): Promise<KycStatusView> => {
  const startedAt = Date.now();
  try {
    const response = await api.post(`/kyc/sessions/${encodeURIComponent(sessionId)}/cancel`);
    const kyc = (response.data as { kyc: KycStatusView }).kyc;
    kycLog('session cancelled', { status: kyc.status, ms: elapsedMs(startedAt) });
    return kyc;
  } catch (error) {
    kycWarn('session cancel failed', { code: codeOf(error), ms: elapsedMs(startedAt) });
    throw new Error(messageOf(error, "Impossible d'annuler la vérification."));
  }
};

const PRECHECK_TIMEOUT_MS = 45000;

// POST /kyc/sessions/:id/precheck/:step : une petite copie de la photo, verifiee AVANT l'envoi. Ne compte pas comme un
// envoi et ne touche pas au dossier : une photo d'un mur est ecartee ici plutot que de faire rejeter la session.
// Toute erreur (reseau, serveur) vaut `skipped` : ce controle ne doit jamais bloquer le parcours.
export const precheckKycPhoto = async (sessionId: string, step: KycPhotoStep, uri: string): Promise<KycPrecheckResult> => {
  const form = new FormData();
  form.append('file', { uri, name: `probe-${step}.jpg`, type: 'image/jpeg' } as unknown as Blob);
  const startedAt = Date.now();
  try {
    const response = await api.post(`/kyc/sessions/${encodeURIComponent(sessionId)}/precheck/${step}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: PRECHECK_TIMEOUT_MS,
      transformRequest: (data) => data,
    });
    const result = (response.data as { result?: KycPrecheckResult }).result;
    const verdict: KycPrecheckResult = result === 'ok' || result === 'no_document' || result === 'no_face' || result === 'mrz_unreadable' ? result : 'skipped';
    kycLog('precheck', { step, result: verdict, ms: elapsedMs(startedAt) });
    return verdict;
  } catch (error) {
    kycWarn('precheck unavailable, going on without it', { step, status: (error as any)?.response?.status, code: codeOf(error), ms: elapsedMs(startedAt) });
    return 'skipped';
  }
};

// POST /kyc/sessions/:id/(front|back|selfie) : une photo JPEG/PNG, champ multipart `file`. Le serveur controle
// le type reel du fichier (pas son nom) et limite la taille a 5 Mo.
export const uploadKycPhoto = async (sessionId: string, step: KycPhotoStep, uri: string): Promise<KycStatusView> => {
  const form = new FormData();
  form.append('file', { uri, name: `${step}.jpg`, type: 'image/jpeg' } as unknown as Blob);
  const startedAt = Date.now();
  kycLog('upload start', { step });
  try {
    const response = await api.post(`/kyc/sessions/${encodeURIComponent(sessionId)}/${step}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: PHOTO_TIMEOUT_MS,
      transformRequest: (data) => data,
    });
    const kyc = (response.data as { kyc: KycStatusView }).kyc;
    kycLog('upload done', { step, status: kyc.status, nextStep: kyc.nextStep, ms: elapsedMs(startedAt) });
    return kyc;
  } catch (error) {
    const status = (error as any)?.response?.status as number | undefined;
    kycWarn('upload failed', { step, status, code: codeOf(error), axiosCode: (error as any)?.code, ms: elapsedMs(startedAt) });
    throw new KycRequestError(messageOf(error, "Impossible d'envoyer la photo."), codeOf(error), status);
  }
};
