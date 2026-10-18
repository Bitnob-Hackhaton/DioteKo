import axios from 'axios';
import { API_BASE_URL } from '../config/config';
import tokenProvider from '../lib/token-provider';
import api from './api';

const EMAIL_AUTH_TIMEOUT_MS = 15000;

export type EmailSession = {
  user: Record<string, unknown>;
  accessToken: string;
};

// Logs verbeux uniquement en dev ; jamais d'email, de mot de passe ni de token.
const devLog = (...args: unknown[]) => {
  if (__DEV__) console.log(...args);
};

// Message utilisateur pour une erreur de /auth/register ou /auth/login (le texte du serveur n'est affiche
// que pour les refus metier : 400 validation, 409 email deja pris, 401 identifiants, 429 trop de tentatives).
function mapEmailAuthError(error: unknown, fallback: string): Error {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error : new Error(fallback);
  }

  const status = error.response?.status;
  const serverMessage = (error.response?.data as { error?: string } | undefined)?.error;

  if (!error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ERR_NETWORK') {
    return new Error(
      __DEV__
        ? `Backend injoignable (${API_BASE_URL}). Verifie l'URL (IP LAN sur telephone) et que le backend tourne.`
        : 'Serveur indisponible ou timeout. Verifie ta connexion puis reessaie.'
    );
  }
  if (status === 429) return new Error('Trop de tentatives. Reessaie dans une minute.');
  if (status && status >= 500) return new Error('Probleme serveur temporaire. Reessaie dans quelques instants.');
  if (status === 409) return new Error('Un compte existe deja avec ces informations. Connecte-toi.');
  if (status === 401) return new Error('Email ou mot de passe incorrect.');
  return new Error(serverMessage || fallback);
}

async function storeSession(data: {
  accessToken?: string;
  refreshToken?: string;
  user?: Record<string, unknown>;
}): Promise<EmailSession> {
  const { accessToken, refreshToken, user } = data;
  if (!accessToken || !refreshToken || !user) {
    throw new Error('Reponse backend incomplete lors de la connexion.');
  }
  await tokenProvider.setSession({ accessToken, refreshToken, user });
  return { user, accessToken };
}

export async function registerWithEmail(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<EmailSession> {
  try {
    devLog('[EmailAuth] [CALL] POST /auth/register');
    const response = await api.post(
      '/auth/register',
      {
        email: input.email.trim(),
        password: input.password,
        ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
      },
      { timeout: EMAIL_AUTH_TIMEOUT_MS, _skipAuth: true }
    );
    const session = await storeSession(response.data);
    devLog('[EmailAuth] [RESULT] register OK, session stored');
    return session;
  } catch (error) {
    throw mapEmailAuthError(error, "Impossible de creer le compte. Verifie les informations saisies.");
  }
}

export async function signInWithEmail(input: { email: string; password: string }): Promise<EmailSession> {
  try {
    devLog('[EmailAuth] [CALL] POST /auth/login');
    const response = await api.post(
      '/auth/login',
      { email: input.email.trim(), password: input.password },
      { timeout: EMAIL_AUTH_TIMEOUT_MS, _skipAuth: true }
    );
    const session = await storeSession(response.data);
    devLog('[EmailAuth] [RESULT] login OK, session stored');
    return session;
  } catch (error) {
    throw mapEmailAuthError(error, 'Connexion impossible. Merci de reessayer.');
  }
}
