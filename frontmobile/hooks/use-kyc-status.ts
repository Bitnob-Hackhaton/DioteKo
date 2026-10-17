import { useCallback, useEffect, useRef, useState } from 'react';
import { getKycStatus, type KycStatusView } from '@/services/kyc';

const POLL_INTERVAL_MS = 4000;

// Dossiers dont le verdict peut encore arriver (webhook ou examen manuel cote prestataire).
const OPEN = new Set(['pending', 'manual_review']);

interface Options {
  // Rafraichit toutes les ~4 s tant que le dossier est ouvert. Hors de l'ecran KYC, une lecture unique suffit.
  poll?: boolean;
}

// Statut KYC du titulaire. Lecture au montage, `refresh()` a la demande, suivi periodique optionnel. Une erreur
// reseau passagere n'efface pas le dernier statut connu : l'erreur est exposee a cote.
export const useKycStatus = ({ poll = false }: Options = {}) => {
  const [kyc, setKyc] = useState<KycStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  // Numero de la derniere ecriture voulue : une reponse plus ancienne que lui est ignoree (elle ecraserait un
  // etat plus recent, ex. le verdict recu juste apres le selfie).
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const mine = ++generation.current;
    try {
      const next = await getKycStatus();
      if (!mounted.current || mine !== generation.current) return;
      setKyc(next);
      setError(null);
    } catch (fetchError) {
      if (mounted.current) setError(fetchError instanceof Error ? fetchError.message : 'Statut indisponible.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  // Premiere lecture : l'etat est ecrit dans les callbacks de la promesse, jamais de facon synchrone dans l'effet.
  useEffect(() => {
    mounted.current = true;
    // Meme garde que `refresh` : un rafraichissement au focus pendant cette premiere lecture n'en lance pas une seconde.
    inFlight.current = true;
    const mine = ++generation.current;
    getKycStatus()
      .then((next) => {
        if (mounted.current && mine === generation.current) setKyc(next);
      })
      .catch((fetchError: unknown) => {
        if (mounted.current) setError(fetchError instanceof Error ? fetchError.message : 'Statut indisponible.');
      })
      .finally(() => {
        inFlight.current = false;
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  const open = kyc ? OPEN.has(kyc.status) : false;
  useEffect(() => {
    if (!poll || !open) return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [poll, open, refresh]);

  // Ecriture explicite (ex. verdict renvoye par l'envoi du selfie) : invalide les lectures encore en vol.
  const replaceKyc = useCallback((next: KycStatusView) => {
    generation.current += 1;
    setKyc(next);
  }, []);

  return { kyc, loading, error, refresh, setKyc: replaceKyc };
};
