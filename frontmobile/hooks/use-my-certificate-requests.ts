import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getCertificateTypes,
  getMyCertificateRequestStats,
  getMyCertificateRequests,
  type CertificateRequestStats,
  type CertificateRequestView,
} from '@/services/api';
import {
  buildTimeline,
  displayName,
  filterToParams,
  formatDate,
  statusDetail,
  toUiStatus,
  typeNameById,
  type CertificateFilter,
  type CertificateUiStatus,
} from '@/services/certificate-requests';

export interface CertificateListItem {
  id: string;
  name: string;
  status: CertificateUiStatus;
  detail: string;
  date: string;
  certificateId: string | null;
  timeline: ReturnType<typeof buildTimeline>;
}

interface Options {
  limit?: number;
  // L'accueil veut aussi les comptes exacts (route `/requests/stats`) ; les listes n'en ont pas besoin.
  withStats?: boolean;
}

// Charge "mes demandes" depuis Nest, filtrees par le serveur. Les types ne servent qu'aux libelles : s'ils echouent,
// on affiche l'identifiant du type plutot que de masquer les demandes.
export const useMyCertificateRequests = ({ limit = 20, withStats = false }: Options = {}) => {
  const [requests, setRequests] = useState<CertificateRequestView[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<CertificateRequestStats | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [filter, setFilterState] = useState<CertificateFilter>('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, typesData, statsData] = await Promise.all([
          getMyCertificateRequests({ limit, ...filterToParams(filter) }),
          getCertificateTypes().catch((typesError) => {
            console.warn('[certificates] types unavailable, falling back to type ids:', typesError);
            return [];
          }),
          withStats ? getMyCertificateRequestStats() : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setError(null);
        setRequests(list.requests);
        setTotal(list.total);
        setNames(typeNameById(typesData));
        setStats(statsData);
      } catch (fetchError) {
        console.error('[certificates] failed to load requests:', fetchError);
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'Impossible de charger vos demandes.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, limit, withStats, reloadKey]);

  // Au retour sur l'ecran (apres un paiement, une acceptation...) la liste se met a jour sans spinner.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      setReloadKey((key) => key + 1);
    }, [])
  );

  // `loading` vaut deja true au premier rendu ; un changement de filtre ou un rechargement le repasse a true
  // (dans le gestionnaire d'evenement, pas dans l'effet) puis relance l'effet.
  const setFilter = useCallback((next: CertificateFilter) => {
    setLoading(true);
    setError(null);
    setFilterState(next);
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  const items = useMemo<CertificateListItem[]>(
    () =>
      requests.map((request) => ({
        id: request.id,
        name: displayName(request, names),
        status: toUiStatus(request.status, request.validity),
        detail: statusDetail(request.status, request.validity),
        date: formatDate(request.createdAt),
        certificateId: request.certificateId,
        timeline: buildTimeline(request.status),
      })),
    [requests, names]
  );

  return { items, total, stats, filter, setFilter, loading, error, reload };
};
