import { useEffect, useRef } from 'react';
import { getInvoiceStatus, type RequestPaymentStatus } from '@/services/api';

const POLL_INTERVAL_MS = 3000;

// Statuts de la demande a partir desquels le paiement est constate (la suite est automatique cote serveur).
const SETTLED = new Set(['paid', 'issuing', 'issued']);

interface Options {
  requestId: string;
  // Le suivi ne tourne que tant qu'une facture est affichee.
  active: boolean;
  onSettled: (status: RequestPaymentStatus) => void;
  // Facture expiree ou echouee : on arrete de suivre, l'ecran propose d'en generer une nouvelle.
  onClosed: (status: RequestPaymentStatus) => void;
}

// Interroge `GET …/lightning-invoices/status` toutes les ~3 s (le serveur relit le fournisseur de paiement).
// S'arrete des que le paiement est constate, que la facture est close, ou que l'ecran est quitte. Une erreur reseau
// passagere n'arrete pas le suivi : le prochain tour reessaie.
export const useInvoicePolling = ({ requestId, active, onSettled, onClosed }: Options) => {
  // Les callbacks changent a chaque rendu : on les lit via une ref pour ne pas relancer l'intervalle.
  const callbacks = useRef({ onSettled, onClosed });
  useEffect(() => {
    callbacks.current = { onSettled, onClosed };
  });

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let inFlight = false;

    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const status = await getInvoiceStatus(requestId);
        if (stopped) return;
        if (SETTLED.has(status.status) || status.invoiceStatus === 'paid') {
          stopped = true;
          callbacks.current.onSettled(status);
        } else if (status.invoiceStatus === 'expired' || status.invoiceStatus === 'failed') {
          stopped = true;
          callbacks.current.onClosed(status);
        }
      } catch (pollError) {
        console.warn('[payment] status check failed, retrying:', pollError);
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(tick, POLL_INTERVAL_MS);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [requestId, active]);
};
