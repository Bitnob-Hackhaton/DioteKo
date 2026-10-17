import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { Guard } from "@/components/console/Can";
import { KycReviewDrawer } from "@/components/console/KycReviewDrawer";
import { KycOriginBadge, KycStatusBadge } from "@/components/console/KycBadges";
import { KYC_ORIGIN_LABELS, KYC_REASON_LABELS, KYC_STATUS_LABELS } from "@/lib/kyc-labels";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, isApiError } from "@/lib/api";
import { formatAge, formatDate } from "@/lib/format";
import type { KycReviewOrigin, KycReviewStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type Search = {
  status?: KycReviewStatus | undefined;
  origin?: KycReviewOrigin | undefined;
  page?: number | undefined;
  id?: string | undefined;
};
const STATUSES = Object.keys(KYC_STATUS_LABELS) as KycReviewStatus[];
const ORIGINS = Object.keys(KYC_ORIGIN_LABELS) as KycReviewOrigin[];
// Par défaut : la file de travail, c'est-à-dire les dossiers qui attendent un agent.
const DEFAULT_STATUS: KycReviewStatus = "manual_review";

export const Route = createFileRoute("/_console/verifications")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    status: STATUSES.includes(s["status"] as KycReviewStatus)
      ? (s["status"] as KycReviewStatus)
      : undefined,
    origin: ORIGINS.includes(s["origin"] as KycReviewOrigin)
      ? (s["origin"] as KycReviewOrigin)
      : undefined,
    page: Number(s["page"]) > 1 ? Number(s["page"]) : undefined,
    id: typeof s["id"] === "string" && s["id"] ? s["id"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Vérifications d'identité — DioteKo Console" },
      { name: "description", content: "Relecture manuelle des pièces d'identité des citoyens." },
    ],
  }),
  component: () => (
    <Guard permission="kyc.review">
      <VerificationsPage />
    </Guard>
  ),
});

const COLS =
  "grid grid-cols-[minmax(130px,1fr)_minmax(150px,1.2fr)_minmax(170px,1.3fr)_minmax(190px,1.4fr)_130px_90px] items-center gap-4";

function VerificationsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/verifications" });
  const filters = {
    status: search.status ?? DEFAULT_STATUS,
    origin: search.origin ?? ("all" as const),
    page: search.page ?? 1,
  };
  const setSearch = (patch: Partial<Search>, resetPage = true) =>
    void navigate({
      search: (prev) => ({ ...prev, ...(resetPage ? { page: undefined } : {}), ...patch }),
      replace: true,
    });

  const list = useQuery({
    queryKey: ["kyc", "list", filters],
    queryFn: () => api.listKycReviews(filters),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-5">
        <h1 className="page-title">Vérifications d'identité</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {list.data ? `${list.data.total} dossier${list.data.total > 1 ? "s" : ""}` : " "}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
        <div className="space-y-1">
          <Label htmlFor="k-status" className="text-xs text-muted-foreground">
            Statut
          </Label>
          <Select
            value={filters.status}
            onValueChange={(v) =>
              setSearch({ status: v === DEFAULT_STATUS ? undefined : (v as KycReviewStatus) })
            }
          >
            <SelectTrigger id="k-status" className="h-9 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {KYC_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="k-origin" className="text-xs text-muted-foreground">
            Origine
          </Label>
          <Select
            value={filters.origin}
            onValueChange={(v) =>
              setSearch({ origin: v === "all" ? undefined : (v as KycReviewOrigin) })
            }
          >
            <SelectTrigger id="k-origin" className="h-9 w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les origines</SelectItem>
              {ORIGINS.map((o) => (
                <SelectItem key={o} value={o}>
                  {KYC_ORIGIN_LABELS[o]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border bg-card">
        <div className="min-w-[960px]">
          <div
            className={cn(
              COLS,
              "border-b bg-muted/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground",
            )}
          >
            <span>Référence</span>
            <span>Titulaire</span>
            <span>Pièce</span>
            <span>Origine</span>
            <span>Statut</span>
            <span className="text-right">Âge</span>
          </div>

          {list.isPending ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={cn(COLS, "h-12 border-b px-4 last:border-0")}>
                {Array.from({ length: 6 }).map((__, j) => (
                  <Skeleton key={j} className="h-4" />
                ))}
              </div>
            ))
          ) : list.isError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-sm">
              <p className="text-status-danger">
                {isApiError(list.error)
                  ? list.error.message
                  : "Impossible de charger les dossiers."}
              </p>
              <Button variant="outline" size="sm" onClick={() => list.refetch()}>
                <RotateCw className="h-4 w-4" /> Réessayer
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {filters.status === DEFAULT_STATUS && filters.origin === "all"
                ? "Aucun dossier en attente de relecture."
                : "Aucun dossier ne correspond à ces filtres."}
            </p>
          ) : (
            items.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSearch({ id: r.id }, false)}
                className={cn(
                  COLS,
                  "w-full border-b px-4 py-3 text-left text-sm last:border-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                )}
              >
                <code className="ref-mono text-xs">{r.reference}</code>
                <span className="truncate font-medium">{r.holderName}</span>
                <span className="min-w-0">
                  <span className="block truncate">{r.documentType ?? "—"}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.failureReason
                      ? (KYC_REASON_LABELS[r.failureReason] ?? r.failureReason)
                      : formatDate(r.createdAt)}
                  </span>
                </span>
                <span>
                  <KycOriginBadge origin={r.origin} />
                </span>
                <span>
                  <KycStatusBadge status={r.status} />
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  {formatAge(r.createdAt)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button
            variant="outline"
            size="icon"
            aria-label="Page précédente"
            disabled={filters.page <= 1}
            onClick={() => setSearch({ page: filters.page - 1 || undefined }, false)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span>
            Page {filters.page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Page suivante"
            disabled={filters.page >= totalPages}
            onClick={() => setSearch({ page: filters.page + 1 }, false)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <KycReviewDrawer id={search.id} onClose={() => setSearch({ id: undefined }, false)} />
    </div>
  );
}
