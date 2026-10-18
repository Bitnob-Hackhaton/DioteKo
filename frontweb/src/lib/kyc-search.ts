import { KYC_ORIGIN_LABELS } from "./kyc-labels";
import type { KycReviewOrigin, KycReviewStatus } from "./types";

/** Paramètres d'URL de `/verifications` : ils survivent à un rechargement et se partagent par lien. */
export type KycSearch = {
  status?: KycReviewStatus | "all" | undefined;
  origin?: KycReviewOrigin | undefined;
  page?: number | undefined;
  id?: string | undefined;
};

/** Valeurs du filtre « Statut », dans l'ordre d'affichage : « Tous les états » (`all`) en dernier. */
export const KYC_LIST_STATUSES: readonly (KycReviewStatus | "all")[] = [
  "manual_review",
  "verified",
  "rejected",
  "all",
];
export const KYC_LIST_ORIGINS = Object.keys(KYC_ORIGIN_LABELS) as KycReviewOrigin[];

/** Par défaut (aucun `status` dans l'URL) : la file de travail, c'est-à-dire les dossiers qui attendent un agent. */
export const KYC_DEFAULT_STATUS: KycReviewStatus = "manual_review";

/** Lit l'URL sans jamais échouer : une valeur inconnue est ignorée (retour à la file de travail). */
export function parseKycSearch(s: Record<string, unknown>): KycSearch {
  return {
    status: KYC_LIST_STATUSES.includes(s["status"] as KycReviewStatus | "all")
      ? (s["status"] as KycReviewStatus | "all")
      : undefined,
    origin: KYC_LIST_ORIGINS.includes(s["origin"] as KycReviewOrigin)
      ? (s["origin"] as KycReviewOrigin)
      : undefined,
    page: Number(s["page"]) > 1 ? Number(s["page"]) : undefined,
    id: typeof s["id"] === "string" && s["id"] ? s["id"] : undefined,
  };
}
