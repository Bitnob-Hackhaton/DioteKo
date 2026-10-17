import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

export type Tokens = {
  accessToken: string;
  refreshToken?: string;
  user: any;
};

type SecretTokens = {
  accessToken: string;
  refreshToken?: string;
};

// Secrets (access + refresh) : SecureStore uniquement.
const SECRET_TOKENS_KEY = 'auth_tokens';
// Snapshot utilisateur (non secret) : AsyncStorage. SecureStore avertit au-dela de ~2048 octets,
// d'ou la separation secrets / profil.
const USER_KEY = 'auth_user';
// Ancienne cle (tout dans SecureStore) : ignoree et supprimee, jamais relue.
const LEGACY_SESSION_KEY = 'user_session';

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const devLog = (...args: unknown[]) => {
  if (__DEV__) console.log(...args);
};

class TokenProvider {
  private session: Tokens | null = null;
  private legacyCleaned = false;
  // Incremente par setSession/clearSession : permet a getSession de detecter qu'une lecture du
  // stockage est devenue perimee pendant ses awaits.
  private epoch = 0;

  // Supprime l'ancienne entree `user_session` (best-effort, une seule fois par lancement)
  private async cleanLegacy() {
    if (this.legacyCleaned) return;
    this.legacyCleaned = true;
    try {
      await SecureStore.deleteItemAsync(LEGACY_SESSION_KEY);
    } catch {
      // ignore : l'ancienne entree n'est de toute facon plus lue
    }
  }

  private async persistSecrets(tokens: SecretTokens) {
    await SecureStore.setItemAsync(SECRET_TOKENS_KEY, JSON.stringify(tokens), SECURE_OPTIONS);
  }

  // Sauvegarder la session. Echoue (throw) si les secrets ne peuvent pas etre ecrits :
  // pas de session "memoire seule".
  async setSession(session: Tokens) {
    this.epoch++;
    try {
      await this.persistSecrets({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      });
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(session.user ?? null));
      this.session = session;
      void this.cleanLegacy();
      devLog('[TokenProvider] Session sauvegardée (secrets: SecureStore, profil: AsyncStorage)');
    } catch (error) {
      // Ne laisser aucune session partielle
      this.session = null;
      try {
        await SecureStore.deleteItemAsync(SECRET_TOKENS_KEY);
      } catch {
        // ignore
      }
      console.error('[TokenProvider] Erreur lors de la sauvegarde:', error);
      throw error;
    }
  }

  // Mise a jour des tokens apres un refresh (le refresh token tourne : l'ancien est mort).
  // Compare-and-set : ne s'applique QUE si la session en memoire porte encore `expectedRefreshToken`
  // (le refresh token utilise pour l'appel). Sinon (session effacee ou changee entre-temps) : no-op,
  // retourne false, et le resultat du refresh doit etre jete. Ne lit JAMAIS le stockage.
  // A appeler AVANT de rejouer les requetes. La memoire est mise a jour en premier pour que la
  // session reste utilisable pendant le lancement courant meme si la persistance echoue (throw).
  async updateTokens(
    tokens: { accessToken: string; refreshToken: string },
    expectedRefreshToken: string
  ): Promise<boolean> {
    const current = this.session;
    if (!current || current.refreshToken !== expectedRefreshToken) {
      devLog('[TokenProvider] updateTokens ignoré : session absente ou différente (refresh périmé)');
      return false;
    }

    const epochAtStart = this.epoch;
    this.session = { ...current, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    try {
      await this.persistSecrets({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    } catch (error) {
      console.error('[TokenProvider] Erreur lors de la persistance des tokens rafraîchis:', error);
      throw error;
    }

    if (this.epoch !== epochAtStart) {
      // clearSession/setSession a eu lieu pendant l'ecriture : realigner le stockage sur l'etat memoire
      // (best-effort) pour ne pas ressusciter une session effacee ni ecraser la nouvelle.
      try {
        if (this.session) {
          await this.persistSecrets({
            accessToken: this.session.accessToken,
            refreshToken: this.session.refreshToken,
          });
        } else {
          await SecureStore.deleteItemAsync(SECRET_TOKENS_KEY);
        }
      } catch {
        // ignore
      }
      devLog('[TokenProvider] updateTokens périmé pendant la persistance : stockage réaligné');
      return false;
    }

    devLog('[TokenProvider] Tokens rafraîchis et persistés');
    return true;
  }

  // Récupérer la session
  async getSession(): Promise<Tokens | null> {
    try {
      if (this.session) return this.session;

      const epochAtStart = this.epoch;
      const storedSecrets = await SecureStore.getItemAsync(SECRET_TOKENS_KEY, SECURE_OPTIONS);
      if (!storedSecrets) {
        void this.cleanLegacy();
        devLog('[TokenProvider] Aucune session trouvée');
        return null;
      }

      const secrets = JSON.parse(storedSecrets) as SecretTokens;
      const storedUser = await AsyncStorage.getItem(USER_KEY);
      const user = storedUser ? JSON.parse(storedUser) : null;

      // setSession/clearSession a eu lieu pendant les lectures : ces donnees sont potentiellement
      // perimees (session effacee, ou autre utilisateur) -> ne rien mettre en cache.
      if (this.epoch !== epochAtStart) {
        devLog('[TokenProvider] Lecture périmée ignorée (session modifiée pendant la lecture)');
        return null;
      }

      if (!secrets?.accessToken || !user) {
        devLog('[TokenProvider] Session incomplète ignorée');
        return null;
      }

      // Une lecture concurrente a pu deja alimenter le cache
      if (this.session) return this.session;

      this.session = { accessToken: secrets.accessToken, refreshToken: secrets.refreshToken, user };
      devLog('[TokenProvider] Session récupérée du stockage');
      return this.session;
    } catch (error) {
      console.error('[TokenProvider] Erreur lors de la récupération:', error);
      return null;
    }
  }

  // Supprimer la session (Logout) : memoire + SecureStore + AsyncStorage, sans jamais throw
  async clearSession() {
    this.epoch++;
    this.session = null;

    const results = await Promise.allSettled([
      SecureStore.deleteItemAsync(SECRET_TOKENS_KEY),
      AsyncStorage.removeItem(USER_KEY),
      SecureStore.deleteItemAsync(LEGACY_SESSION_KEY),
    ]);

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`[TokenProvider] Erreur lors de la suppression (étape ${index}):`, result.reason);
      }
    });
    devLog('[TokenProvider] Session supprimée (Logout)');
  }

  //  Vérifier si connecté
  async isLoggedIn(): Promise<boolean> {
    const session = await this.getSession();
    return !!session?.accessToken;
  }
}

const tokenProvider = new TokenProvider();
export default tokenProvider;
