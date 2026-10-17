import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../config/config';
import tokenProvider from '../lib/token-provider';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Ne pas attacher le Bearer ni tenter de refresh (endpoints d'auth). */
    _skipAuth?: boolean;
    /** Requete deja rejouee apres un refresh (evite toute boucle). */
    _retry?: boolean;
  }
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

const REFRESH_TIMEOUT_MS = 15000;
const AUTH_ENDPOINTS = ['/auth/appwrite/login', '/auth/refresh', '/auth/logout'];

const devLog = (...args: unknown[]) => {
  if (__DEV__) console.log(...args);
};

// --- Session expiree : notifie le GlobalProvider (module-level, pas d'import de React ici) ---
let sessionExpiredHandler: (() => void) | null = null;

export const setSessionExpiredHandler = (handler: (() => void) | null) => {
  sessionExpiredHandler = handler;
};

const expireSession = async () => {
  devLog('[Auth] session expirée : nettoyage local');
  await tokenProvider.clearSession();
  try {
    sessionExpiredHandler?.();
  } catch (error) {
    console.error('[Auth] session-expired handler error:', error);
  }
};

// --- Helpers URL : le Bearer ne doit JAMAIS partir vers un autre hote que API_BASE_URL ---
const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

const resolveRequestUrl = (config: AxiosRequestConfig): string => {
  const url = config.url ?? '';
  // Meme definition qu'axios (inclut les URLs protocol-relative "//host")
  if (/^([a-z][a-z\d+\-.]*:)?\/\//i.test(url)) {
    return url;
  }
  const base = stripTrailingSlashes(config.baseURL ?? '');
  return url ? `${base}/${url.replace(/^\/+/, '')}` : base;
};

const isApiUrl = (config: AxiosRequestConfig): boolean => {
  const target = resolveRequestUrl(config).toLowerCase();
  const apiBase = stripTrailingSlashes(API_BASE_URL).toLowerCase();
  if (!target.startsWith(apiBase)) return false;
  const next = target.charAt(apiBase.length);
  return next === '' || next === '/' || next === '?' || next === '#';
};

const isAuthEndpoint = (config: AxiosRequestConfig): boolean => {
  const path = (config.url ?? '').split('?')[0];
  return AUTH_ENDPOINTS.some((endpoint) => path.endsWith(endpoint));
};

const shouldSkipAuth = (config: AxiosRequestConfig): boolean =>
  Boolean(config._skipAuth) || isAuthEndpoint(config);

const readBearer = (config: AxiosRequestConfig): string | undefined => {
  const header = (config.headers as any)?.Authorization ?? (config.headers as any)?.get?.('Authorization');
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
};

// --- Request : attache le access token ---
api.interceptors.request.use(async (config) => {
  if (shouldSkipAuth(config) || !isApiUrl(config)) {
    return config;
  }

  const session = await tokenProvider.getSession();
  if (session?.accessToken) {
    config.headers.set('Authorization', `Bearer ${session.accessToken}`);
  }
  return config;
});

// --- Response : refresh single-flight sur 401 ---
let refreshPromise: Promise<string | null> | null = null;

// Attend la fin d'un refresh en cours (s'il y en a un) ; ne throw jamais. Utilise par le logout
// pour ne pas lire/revoquer un refresh token pendant qu'il est en train de tourner.
export const waitForRefresh = async (): Promise<void> => {
  if (refreshPromise) {
    await refreshPromise.catch(() => null);
  }
};

// Retourne le nouvel access token, ou null (terminal, transitoire ou resultat jete car la session a
// change — l'appelant rejette la requete d'origine).
const refreshAccessToken = async (): Promise<string | null> => {
  const session = await tokenProvider.getSession();
  const refreshToken = session?.refreshToken;

  if (!refreshToken) {
    // Session sans refresh token : impossible de la renouveler
    await expireSession();
    return null;
  }

  try {
    devLog('[Auth] [CALL] POST /auth/refresh');
    // Instance axios NUE : pas d'intercepteurs (evite recursion et Bearer parasite)
    const response = await axios.post(
      `${API_BASE_URL}/auth/refresh`,
      { refreshToken },
      { timeout: REFRESH_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } }
    );

    const newAccessToken = response?.data?.accessToken as string | undefined;
    const newRefreshToken = response?.data?.refreshToken as string | undefined;
    if (!newAccessToken || !newRefreshToken) {
      // Reponse inattendue : ne pas detruire la session sur une hypothese
      console.error('[Auth] [RESULT] refresh: réponse backend incomplète');
      return null;
    }

    try {
      // Compare-and-set : persister AVANT de rejouer (le refresh token a tourne : l'ancien est mort),
      // mais seulement si la session porte encore le refresh token utilise pour cet appel.
      const applied = await tokenProvider.updateTokens(
        { accessToken: newAccessToken, refreshToken: newRefreshToken },
        refreshToken
      );
      if (!applied) {
        // Session effacee (logout) ou remplacee (autre utilisateur) pendant le refresh : jeter le resultat,
        // ne pas rejouer avec le nouveau token (l'appelant rejette la requete d'origine).
        console.warn('[Auth] [RESULT] refresh ignoré : session modifiée pendant le refresh');
        return null;
      }
    } catch (persistError) {
      // CAS accepte : la memoire a deja les nouveaux tokens mais la persistance a echoue.
      // On rejoue, la persistance sera retentee au prochain refresh.
      console.error('[Auth] [RESULT] refresh: persistance des tokens échouée', persistError);
    }

    devLog('[Auth] [RESULT] refresh OK');
    return newAccessToken;
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (status === 401 || status === 403) {
      // Terminal : refresh token invalide/expire/revoque, ou compte suspendu.
      // N'effacer que si la session courante est toujours celle qui a ete refusee
      // (sinon on detruirait la session d'un utilisateur connecte entre-temps).
      console.warn('[Auth] [RESULT] refresh refusé', { status });
      const currentSession = await tokenProvider.getSession();
      if (currentSession?.refreshToken === refreshToken) {
        await expireSession();
      }
      return null;
    }
    // Reseau / timeout / 5xx : on garde la session
    console.warn('[Auth] [RESULT] refresh indisponible (session conservée)', {
      status,
      code: axios.isAxiosError(error) ? error.code : undefined,
    });
    return null;
  }
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as AxiosRequestConfig | undefined;

    if (
      !axios.isAxiosError(error)
      || error.response?.status !== 401
      || !original
      || shouldSkipAuth(original)
      || original._retry
      || !isApiUrl(original)
    ) {
      return Promise.reject(error);
    }

    const sentToken = readBearer(original);
    const session = await tokenProvider.getSession();

    // Requete partie sans session (ou session effacee entre-temps) : rien a rafraichir
    if (!sentToken || !session?.accessToken) {
      return Promise.reject(error);
    }

    // Un autre refresh a deja fait tourner le token depuis l'envoi : rejouer directement
    if (session.accessToken !== sentToken) {
      original._retry = true;
      return api.request(original);
    }

    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }

    const newAccessToken = await refreshPromise;
    if (!newAccessToken) {
      return Promise.reject(error);
    }

    original._retry = true;
    // Le request interceptor re-attache le Bearer a jour depuis le tokenProvider
    return api.request(original);
  }
);

// Le backend Nest repond `{ success: false, error: "<message>" }` : ce message prime sur celui d'axios
// ("Request failed with status code 404"), qui n'aide pas l'utilisateur.
const getErrorMessage = (error: unknown, fallback: string): string => {
  const serverMessage = (error as any)?.response?.data?.error;
  if (typeof serverMessage === 'string' && serverMessage) {
    return serverMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
};

// Erreur d'API portant le code machine du serveur (ex. `KYC_REQUIRED`) a cote du message affichable.
export class ApiRequestError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

// Le backend ajoute `code` (MAJUSCULES_SNAKE) aux reponses d'erreur qui en portent un.
const getErrorCode = (error: unknown): string | undefined => {
  const code = (error as any)?.response?.data?.code;
  return typeof code === 'string' ? code : undefined;
};

export const KYC_REQUIRED_CODE = 'KYC_REQUIRED';

// Le serveur exige une verification d'identite validee pour ce type : l'ecran renvoie vers /kyc.
export const isKycRequiredError = (error: unknown): boolean =>
  error instanceof ApiRequestError && error.code === KYC_REQUIRED_CODE;

// Certificate Types
export interface CertificateTypeInfo {
  id: string;
  name: string;
  priceSats: number;
  // Politique de verification d'identite : `required` bloque le depot sans KYC valide ; `planned` deviendra
  // obligatoire (non bloquant aujourd'hui). Le serveur reste l'autorite.
  kyc: 'required' | 'planned';
}

// GET /admin-certificates/types (route publique de backend-nest) -> `{ success, types: [{ id, name, priceSats }] }`.
// Les prix du serveur font foi : l'UI ne doit pas afficher les siens.
export const getCertificateTypes = async (): Promise<CertificateTypeInfo[]> => {
  try {
    const response = await api.get('/admin-certificates/types');
    return (response.data as { types: CertificateTypeInfo[] }).types;
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Failed to fetch certificate types'));
  }
};

// Cycle de vie d'une demande (voir backend-nest `AdminCertificateRequestStatus`) :
// pending (a verifier) -> accepted (a payer) -> awaiting_payment -> paid -> issuing -> issued ; ou rejected,
// ou needs_info (complement demande par l'agent) -> pending.
export type CertificateRequestStatus =
  | 'pending'
  | 'accepted'
  | 'needs_info'
  | 'awaiting_payment'
  | 'paid'
  | 'issuing'
  | 'issued'
  | 'rejected';

// Vue "titulaire" d'une demande (GET /admin-certificates/requests[/:id]). `submittedData` n'est present que sur le detail.
export interface CertificateRequestView {
  id: string;
  certificateType: string;
  status: CertificateRequestStatus;
  priceSats: number | null;
  paymentId: string | null;
  // Motif du refus, ou message de l'agent quand un complement est demande ; `null` sinon.
  decisionReason: string | null;
  certificateId: string | null;
  // Expiration du certificat emis ; `null` avant l'emission. `validity` est calculee par le serveur.
  expiresAt: string | null;
  validity: CertificateValidity | null;
  createdAt: string;
  updatedAt: string;
  submittedData?: Record<string, unknown>;
}

export type CertificateValidity = 'valid' | 'expiring_soon' | 'expired' | 'revoked';

export interface CertificateRequestFilter {
  // Un ou plusieurs statuts (le serveur accepte une liste separee par des virgules).
  status?: CertificateRequestStatus[];
  validity?: CertificateValidity;
}

export interface CertificateRequestStats {
  total: number;
  byStatus: Record<CertificateRequestStatus, number>;
  byValidity: Record<CertificateValidity, number>;
}

// POST /admin-certificates/requests renvoie la meme vue titulaire que la liste (`{ success, request }`), avec `submittedData`.
// Le statut initial est `accepted` (type sans verification) ou `pending` (a verifier par un agent).
export type CreatedCertificateRequest = CertificateRequestView;

// POST /admin-certificates/requests. Le corps ne doit contenir QUE `certificateType` et `submittedData` : le
// ValidationPipe du backend (`forbidNonWhitelisted`) refuse tout autre champ (ex. l'ancien `payment_hash`).
// Le paiement vient ensuite (`/requests/:id/lightning-invoices`), puis l'emission.
export const createCertificateRequest = async (
  certificateType: string,
  submittedData: Record<string, unknown>
): Promise<CreatedCertificateRequest> => {
  try {
    const response = await api.post('/admin-certificates/requests', { certificateType, submittedData });
    return (response.data as { request: CreatedCertificateRequest }).request;
  } catch (error) {
    throw new ApiRequestError(getErrorMessage(error, 'Failed to create certificate request'), getErrorCode(error));
  }
};

// GET /admin-certificates/requests : uniquement les demandes de l'utilisateur connecte, sans `submittedData`.
// Les filtres sont appliques par le serveur ; `total` tient compte des filtres (avant pagination).
export const getMyCertificateRequests = async (
  params: { limit?: number; offset?: number } & CertificateRequestFilter = {}
): Promise<{ requests: CertificateRequestView[]; total: number }> => {
  try {
    const { status, ...rest } = params;
    const response = await api.get('/admin-certificates/requests', {
      params: { ...rest, ...(status && status.length > 0 ? { status: status.join(',') } : {}) },
    });
    const data = response.data as { requests: CertificateRequestView[]; total: number };
    return { requests: data.requests, total: data.total };
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Failed to fetch your certificate requests'));
  }
};

// GET /admin-certificates/requests/stats : comptes exacts (tous statuts, toute validite) des demandes de l'utilisateur.
export const getMyCertificateRequestStats = async (): Promise<CertificateRequestStats> => {
  try {
    const response = await api.get('/admin-certificates/requests/stats');
    return (response.data as { stats: CertificateRequestStats }).stats;
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Failed to fetch your certificate statistics'));
  }
};

// POST /admin-certificates/requests/:id/resubmit : repond a un "complement demande" (statut needs_info) ; remplace
// `submittedData` en entier et remet la demande a verifier.
export const resubmitCertificateRequest = async (
  requestId: string,
  submittedData: Record<string, unknown>
): Promise<CertificateRequestView> => {
  try {
    const response = await api.post(`/admin-certificates/requests/${encodeURIComponent(requestId)}/resubmit`, {
      submittedData,
    });
    return (response.data as { request: CertificateRequestView }).request;
  } catch (error) {
    throw new ApiRequestError(getErrorMessage(error, 'Failed to resubmit certificate request'), getErrorCode(error));
  }
};

// Facture Lightning a payer pour une demande acceptee.
export interface RequestInvoice {
  provider: string;
  // Chaine BOLT11 a afficher en QR / copier.
  paymentRequest: string;
  amountSats: number;
  expiresAt: string | null;
}

// POST /admin-certificates/requests/:id/lightning-invoices : seulement depuis le statut `accepted` (400 sinon) ;
// 409 si une facture est deja en cours de creation pour cette demande.
export const createLightningInvoice = async (requestId: string): Promise<RequestInvoice> => {
  try {
    const response = await api.post(`/admin-certificates/requests/${encodeURIComponent(requestId)}/lightning-invoices`);
    return (response.data as { invoice: RequestInvoice }).invoice;
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Failed to create the payment invoice'));
  }
};

// GET /admin-certificates/requests/:id/lightning-invoice : la facture encore payable, pour rouvrir l'ecran de paiement
// (le BOLT11 n'est renvoye qu'a la creation). 404 s'il n'y en a plus (expiree, payee...) -> `null`.
export const getOpenInvoice = async (requestId: string): Promise<RequestInvoice | null> => {
  try {
    const response = await api.get(`/admin-certificates/requests/${encodeURIComponent(requestId)}/lightning-invoice`);
    return (response.data as { invoice: RequestInvoice }).invoice;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    throw new Error(getErrorMessage(error, 'Failed to fetch the payment invoice'));
  }
};

export interface RequestPaymentStatus {
  requestId: string;
  // Statut de la demande : passe a `paid` puis `issuing` / `issued` des que le paiement est constate.
  status: CertificateRequestStatus;
  invoiceStatus: 'pending' | 'paid' | 'expired' | 'failed';
}

// GET /admin-certificates/requests/:id/lightning-invoices/status : interroge le fournisseur puis renvoie l'etat.
export const getInvoiceStatus = async (requestId: string): Promise<RequestPaymentStatus> => {
  try {
    const response = await api.get(
      `/admin-certificates/requests/${encodeURIComponent(requestId)}/lightning-invoices/status`
    );
    return response.data as RequestPaymentStatus;
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Failed to check the payment status'));
  }
};

// GET /admin-certificates/config (authentifie) : `paymentSimulation` n'est vrai qu'en developpement.
export const getPaymentConfig = async (): Promise<{ paymentSimulation: boolean }> => {
  try {
    const response = await api.get('/admin-certificates/config');
    return { paymentSimulation: Boolean((response.data as { paymentSimulation?: boolean }).paymentSimulation) };
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Failed to fetch the payment configuration'));
  }
};

// POST /admin-certificates/dev/requests/:id/mark-paid : DEV SEULEMENT (404 si PAYMENT_SIMULATION est desactive).
// Marque la vraie facture payee ; le certificat est ensuite genere par le serveur comme apres un vrai paiement.
export const simulatePayment = async (requestId: string): Promise<void> => {
  try {
    await api.post(`/admin-certificates/dev/requests/${encodeURIComponent(requestId)}/mark-paid`);
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Failed to simulate the payment'));
  }
};

// GET /admin-certificates/requests/:id/file-link : lien signe et de courte duree vers le PDF (le navigateur du telephone
// n'envoie pas le Bearer). 404 si la demande n'est pas a l'utilisateur ou si aucun certificat n'est emis.
export const getCertificateFileUrl = async (requestId: string): Promise<string> => {
  try {
    const response = await api.get(`/admin-certificates/requests/${encodeURIComponent(requestId)}/file-link`);
    return `${API_BASE_URL}${(response.data as { url: string }).url}`;
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Failed to get the certificate download link'));
  }
};

// GET /admin-certificates/requests/:id : 404 si la demande n'est pas a l'utilisateur connecte.
export const getMyCertificateRequest = async (requestId: string): Promise<CertificateRequestView> => {
  try {
    const response = await api.get(`/admin-certificates/requests/${encodeURIComponent(requestId)}`);
    return (response.data as { request: CertificateRequestView }).request;
  } catch (error) {
    throw new Error(getErrorMessage(error, 'Failed to fetch certificate request'));
  }
};

export type CertificateVerificationReason = 'revoked' | 'expired' | 'signature_invalid' | 'hash_mismatch';

export interface CertificateVerification {
  valid: boolean;
  message: string;
  certificateId: string;
  reason?: CertificateVerificationReason;
  certificateType?: string;
  issuedAt?: string;
  expiresAt?: string;
}

const VERIFY_REASON_MESSAGES: Record<CertificateVerificationReason, string> = {
  revoked: 'This certificate has been revoked.',
  expired: 'This certificate has expired.',
  signature_invalid: 'The signature of this certificate is invalid.',
  hash_mismatch: 'The document hash does not match this certificate.',
};

// Les QR emis par le backend encodent `dioteko://verify?certificateId=<id>` ; un identifiant brut reste accepte.
export const extractCertificateId = (raw: string): string => {
  const value = raw.trim();
  const match = value.match(/[?&]certificateId=([^&#\s]+)/i);
  if (!match) {
    return value;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

// POST /admin-certificates/:certificateId/verify (route publique de backend-nest).
// Un certificat invalide (revoque, expire...) repond 200 avec `valid: false` ; seul un id inconnu repond 404.
export const verifyCertificate = async (
  certificateIdOrLink: string,
  documentHash?: string
): Promise<CertificateVerification> => {
  const certificateId = extractCertificateId(certificateIdOrLink);
  try {
    const response = await api.post(
      `/admin-certificates/${encodeURIComponent(certificateId)}/verify`,
      documentHash ? { documentHash } : {}
    );
    const data = response.data as {
      valid: boolean;
      reason?: CertificateVerificationReason;
      certificateType?: string;
      issuedAt?: string;
      expiresAt?: string;
    };
    return {
      valid: data.valid,
      message: data.valid
        ? 'This certificate is authentic and valid.'
        : (data.reason && VERIFY_REASON_MESSAGES[data.reason]) || 'This certificate is not valid.',
      certificateId,
      reason: data.reason,
      certificateType: data.certificateType,
      issuedAt: data.issuedAt,
      expiresAt: data.expiresAt,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return { valid: false, message: 'Certificate not found.', certificateId };
    }
    throw new Error(getErrorMessage(error, 'Failed to verify certificate'));
  }
};

// Mock API calls: the only consumer is app/admin/TPoSScreen.tsx (an unlinked UI mockup, no backend behind it).
const mockApiCall = (data: any) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(data);
    }, 1000);
  });
};

// TPoS (Terminal Point of Sale) API
export const getTPoSTerminals = async () => {
  return mockApiCall([
    { id: '1', name: 'Terminal Principal', location: 'Mairie de Dakar', status: 'active', transactions: 156 },
    { id: '2', name: 'Terminal Annex', location: 'Mairie de Thiès', status: 'active', transactions: 89 },
    { id: '3', name: 'Terminal Mobile', location: 'Service Mobile', status: 'inactive', transactions: 23 },
  ]);
};

export const createTPoSTerminal = async (terminalData: any) => {
  return mockApiCall({
    success: true,
    terminal: { id: '4', ...terminalData, status: 'active', transactions: 0 },
  });
};

export default api;