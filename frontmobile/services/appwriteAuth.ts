import 'react-native-url-polyfill/auto';

import axios from 'axios';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Account, AppwriteException, Client, OAuthProvider } from 'react-native-appwrite';
import { API_BASE_URL, APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID } from '../config/config';
import tokenProvider from '../lib/token-provider';
import api, { waitForRefresh } from './api';

WebBrowser.maybeCompleteAuthSession();

const APPWRITE_BACKEND_TIMEOUT_MS = 12000;
const LOGOUT_STEP_TIMEOUT_MS = 5000;

// Logs verbeux uniquement en dev ; jamais de secret / userId / JWT.
const devLog = (...args: unknown[]) => {
  if (__DEV__) console.log(...args);
};
const devError = (...args: unknown[]) => {
  if (__DEV__) console.error(...args);
};

// Bundle id / package name registered as a platform in the Appwrite console.
// This is a placeholder ("com.dioteko.app") mirrored from app.json — it MUST
// match the platform actually registered for this Appwrite project, or
// `Client.setPlatform()` origin checks will reject the app. See app.json.
const APPWRITE_PLATFORM = 'com.dioteko.app';

const client = new Client();

if (APPWRITE_ENDPOINT && APPWRITE_PROJECT_ID) {
  client.setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setPlatform(APPWRITE_PLATFORM);
}

const account = new Account(client);

export type GoogleSession = {
  user: Record<string, unknown>;
  accessToken: string;
};

function getStringQueryParam(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return undefined;
}

// Le SDK mobile (>= 0.3x) appelle POST /account/jwts (Appwrite >= 1.6). Un serveur 1.5.x n'expose que
// POST /account/jwt : on rejoue alors sur l'ancienne route.
// TODO: retirer ce fallback quand le serveur Appwrite sera migre en >= 1.6.
async function createAppwriteJwt(): Promise<string> {
  try {
    return (await account.createJWT()).jwt;
  } catch (error) {
    if (!(error instanceof AppwriteException) || error.code !== 404 || error.type !== 'general_route_not_found') {
      throw error;
    }
    devLog('[Google] [CALL] fallback POST /account/jwt (serveur Appwrite < 1.6)');
    const legacy = await client.call(
      'post',
      new URL(`${APPWRITE_ENDPOINT.replace(/\/+$/, '')}/account/jwt`),
      // Comme createJWT() du SDK : sans X-Appwrite-Project, Appwrite ne retrouve pas le projet
      // et rejette l'origine (403 general_unknown_origin).
      {
        'X-Appwrite-Project': APPWRITE_PROJECT_ID,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      {}
    );
    if (!legacy?.jwt || typeof legacy.jwt !== 'string') {
      throw new Error('Reponse Appwrite incomplete lors de la creation du JWT');
    }
    return legacy.jwt;
  }
}

// Message utilisateur pour une erreur du SDK Appwrite (jamais le texte brut du serveur).
function mapAppwriteError(error: AppwriteException): string {
  if (error.code === 404 && error.type === 'general_route_not_found') {
    return "Service d'authentification indisponible (version incompatible).";
  }
  if (error.code === 401 || error.code === 403) {
    return 'Connexion Google refusee. Reessaie.';
  }
  if (error.code === 429) {
    return 'Trop de tentatives. Reessaie dans un instant.';
  }
  if (!error.code || error.code >= 500) {
    return 'Serveur indisponible ou timeout. Verifie que le backend est demarre puis reessaie.';
  }
  return 'Erreur de connexion Google. Merci de reessayer.';
}

export async function signInWithGoogle(): Promise<GoogleSession> {
  try {
    if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID) {
      throw new Error('Configuration Appwrite manquante. Verifie les variables EXPO_PUBLIC_APPWRITE_*.');
    }

    const redirectUri = Linking.createURL('auth/google/callback');
    devLog('[Google] start login', { redirectUri, appwriteEndpoint: APPWRITE_ENDPOINT });

    const loginUrl = account.createOAuth2Token({
      provider: OAuthProvider.Google,
      success: redirectUri,
      failure: redirectUri,
    });

    if (!loginUrl) {
      throw new Error('Impossible de generer le lien de connexion Google');
    }

    devLog('[Google] opening auth session');
    const authResult = await WebBrowser.openAuthSessionAsync(loginUrl.toString(), redirectUri);
    devLog('[Google] browser auth result', { type: authResult.type });

    if (authResult.type !== 'success') {
      throw new Error('Connexion Google annulee');
    }

    const parsed = Linking.parse(authResult.url);
    const userId = getStringQueryParam(parsed.queryParams?.userId);
    const secret = getStringQueryParam(parsed.queryParams?.secret);
    devLog('[Google] callback parsed', { hasUserId: Boolean(userId), hasSecret: Boolean(secret) });

    if (!userId || !secret) {
      throw new Error('Reponse Google incomplete. Merci de reessayer.');
    }

    // Une session Appwrite orpheline (echec precedent) bloquerait createSession : nettoyage best-effort
    await deleteCurrentAppwriteSessionQuietly();
    await account.createSession({ userId, secret });
    devLog('[Google] appwrite session created');

    // A partir d'ici une session Appwrite existe : sur TOUT echec, la supprimer (best-effort)
    // et relancer l'erreur d'origine telle quelle (le mapping d'erreurs ci-dessous reste inchange).
    try {
      const appwriteJwt = await createAppwriteJwt();
      devLog('[Google] appwrite jwt obtained');

      const backendResponse = await api.post(
        '/auth/appwrite/login',
        { appwriteJwt },
        { timeout: APPWRITE_BACKEND_TIMEOUT_MS, _skipAuth: true }
      );

      const accessToken = backendResponse?.data?.accessToken as string | undefined;
      const refreshToken = backendResponse?.data?.refreshToken as string | undefined;
      const user = backendResponse?.data?.user;

      if (!accessToken || !refreshToken || !user) {
        throw new Error('Reponse backend incomplete lors de la connexion Google');
      }

      await tokenProvider.setSession({ accessToken, refreshToken, user });
      devLog('[Google] session stored successfully via TokenProvider');

      return { user, accessToken };
    } catch (postSessionError) {
      await deleteCurrentAppwriteSessionQuietly();
      throw postSessionError;
    }
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status;
      const backendMessage =
        (error.response?.data as { message?: string; error?: string } | undefined)?.message
        || (error.response?.data as { message?: string; error?: string } | undefined)?.error;

      devError('[Google] axios error', {
        message: error.message,
        code: error.code,
        statusCode,
        backendMessage,
        apiBaseUrl: API_BASE_URL,
      });

      if (
        !error.response
        || error.code === 'ECONNABORTED'
        || error.code === 'ETIMEDOUT'
        || error.code === 'ERR_NETWORK'
      ) {
        throw new Error(
          __DEV__
            ? `Backend injoignable (${API_BASE_URL}). Verifie l'URL (IP LAN sur telephone) et que le backend tourne.`
            : 'Serveur indisponible ou timeout. Verifie que le backend est demarre puis reessaie.'
        );
      }

      if (statusCode && statusCode >= 500) {
        throw new Error('Probleme serveur temporaire. Reessaie dans quelques instants.');
      }

      throw new Error(backendMessage || 'Erreur de connexion Google. Merci de reessayer.');
    }

    if (error instanceof AppwriteException) {
      devError('[Google] [RESULT] appwrite error', { code: error.code, type: error.type });
      throw new Error(mapAppwriteError(error));
    }

    devError('[Google] unexpected error', error);
    throw error instanceof Error ? error : new Error('Connexion Google echouee');
  }
}

// Rejette si `promise` ne se resout pas dans `ms` (le SDK Appwrite n'expose pas de timeout).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Supprime la session Appwrite courante, best-effort : timeout borne, erreurs avalees
// (ex. aucune session a supprimer). Ne throw jamais.
async function deleteCurrentAppwriteSessionQuietly(): Promise<void> {
  try {
    await withTimeout(account.deleteSession({ sessionId: 'current' }), LOGOUT_STEP_TIMEOUT_MS);
    devLog('[Google] appwrite session cleanup OK');
  } catch {
    // ignore : best-effort
  }
}

/**
 * Vrai logout, best-effort et sans jamais throw :
 *  (a) revoque le refresh token cote backend,
 *  (b) supprime la session Appwrite courante,
 *  (c) efface TOUJOURS la session locale en dernier.
 */
export async function clearGoogleSession(): Promise<void> {
  // Ne pas lire/revoquer le refresh token pendant qu'un refresh en cours est en train de le faire tourner
  await waitForRefresh();

  let refreshToken: string | undefined;
  try {
    refreshToken = (await tokenProvider.getSession())?.refreshToken;
  } catch {
    refreshToken = undefined;
  }

  // (a) backend
  try {
    if (refreshToken) {
      await api.post(
        '/auth/logout',
        { refreshToken },
        { timeout: LOGOUT_STEP_TIMEOUT_MS, _skipAuth: true }
      );
      devLog('[Google] backend logout OK');
    }
  } catch (error) {
    devError('[Google] backend logout failed (ignored)', axios.isAxiosError(error) ? error.code : error);
  }

  // (b) session Appwrite
  try {
    await withTimeout(account.deleteSession({ sessionId: 'current' }), LOGOUT_STEP_TIMEOUT_MS);
    devLog('[Google] appwrite session deleted');
  } catch (error) {
    devError('[Google] appwrite deleteSession failed (ignored)', error instanceof Error ? error.message : error);
  }

  // (c) local, toujours en dernier
  try {
    await tokenProvider.clearSession();
  } catch (error) {
    devError('[Google] local clearSession failed', error);
  }
}
