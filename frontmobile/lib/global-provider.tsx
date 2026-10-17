import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { clearGoogleSession } from '../services/appwriteAuth';
import { setSessionExpiredHandler } from '../services/api';
import tokenProvider from './token-provider';

interface GlobalContextType {
  isLoggedIn: boolean;
  user: any | null;
  loading: boolean;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

const GlobalContext = createContext<GlobalContextType | undefined>(undefined);

export const GlobalProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSession = async () => {
    try {
      setLoading(true);
      const session = await tokenProvider.getSession();
      
      // Pas de donnees personnelles ni de token dans les logs : etat uniquement (dev)
      if (__DEV__) {
        console.log('[GlobalProvider] Session:', session?.user ? 'CONNECTÉ' : 'DÉCONNECTÉ');
      }

      if (session && session.user) {
        setUser(session.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('[GlobalProvider] Error fetching session:', error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSession();
  }, []);

  // Refresh token refuse (revoque / expire / compte suspendu) : retour a l'ecran de connexion
  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
    return () => setSessionExpiredHandler(null);
  }, []);

  const refetch = async () => {
    await fetchSession();
  };

  const logout = async () => {
    try {
      if (__DEV__) console.log('[GlobalProvider] Initialisation du Logout...');
      // Best-effort, ne throw jamais : backend + Appwrite + stockage local
      await clearGoogleSession();
      if (__DEV__) console.log('[GlobalProvider] Déconnexion réussie');
    } catch (error) {
      console.error('[GlobalProvider] Error during logout:', error);
    } finally {
      setUser(null);
    }
  };

  return (
    <GlobalContext.Provider
      value={{
        isLoggedIn: !!user,
        user,
        loading,
        refetch,
        logout,
      }}
    >
      {children}
    </GlobalContext.Provider>
  );
};

export const useGlobalContext = (): GlobalContextType => {
  const context = useContext(GlobalContext);
  if (!context) {
    throw new Error('useGlobalContext must be used within a GlobalProvider');
  }
  return context;
};

export default GlobalProvider;
