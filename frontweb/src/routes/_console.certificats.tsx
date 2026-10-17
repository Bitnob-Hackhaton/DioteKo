import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { Guard } from "@/components/console/Can";
import {
  CertificateStatusBadge,
  CERT_STATUS_META,
} from "@/components/console/CertificateStatusBadge";
import { CertificatePanel } from "@/components/console/CertificatePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { formatDate, shortName } from "@/lib/format";
import type { CertificateStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type Search = {
  status?: CertificateStatus | undefined;
  type?: string | undefined;
  q?: string | undefined;
  page?: number | undefined;
  id?: string | undefined;
};
const STATUSES = ["valid", "expired", "revoked"] as const;

export const Route = createFileRoute("/_console/certificats")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    status: STATUSES.includes(s["status"] as CertificateStatus)
      ? (s["status"] as CertificateStatus)
      : undefined,
    type: typeof s["type"] === "string" && s["type"] ? s["type"] : undefined,
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    page: Number(s["page"]) > 1 ? Number(s["page"]) : undefined,
    id: typeof s["id"] === "string" && s["id"] ? s["id"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Certificats — DioteKo Console" },
      { name: "description", content: "Certificats émis : recherche, vérification et révocation." },
      { property: "og:title", content: "Certificats — DioteKo Console" },
      {
        property: "og:description",
        content: "Certificats émis : recherche, vérification et révocation.",
      },
    ],
  }),
  component: () => (
    <Guard permission="certificate.view">
      <CertificatesPage />
    </Guard>
  ),
});

const COLS =
  "grid grid-cols-[minmax(170px,1.2fr)_minmax(180px,1.4fr)_minmax(150px,1.2fr)_120px_130px_120px] items-center gap-4";

function CertificatesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/certificats" });
  const filters = {
    status: search.status ?? ("all" as const),
    type: search.type,
    q: search.q,
    page: search.page ?? 1,
  };
  const setSearch = (patch: Partial<Search>, resetPage = true) =>
    void navigate({
      search: (prev) => ({ ...prev, ...(resetPage ? { page: undefined } : {}), ...patch }),
      replace: true,
    });

  const types = useQuery({ queryKey: ["types"], queryFn: api.types, staleTime: Infinity });
  const list = useQuery({
    queryKey: ["certificates", "list", filters],
    queryFn: () => api.listCertificates(filters),
    placeholderData: keepPreviousData,
  });
  const [qDraft, setQDraft] = useState(search.q ?? "");
  useEffect(() => {
    setQDraft(search.q ?? "");
  }, [search.q]);

  const items = list.data?.items ?? [];
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-5">
        <h1 className="page-title">Certificats</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {list.data ? `${list.data.total} certificat${list.data.total > 1 ? "s" : ""}` : "\u00a0"}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
        <div className="space-y-1">
          <Label htmlFor="c-status" className="text-xs text-muted-foreground">
            Statut
          </Label>
          <Select
            value={filters.status}
            onValueChange={(v) =>
              setSearch({ status: v === "all" ? undefined : (v as CertificateStatus) })
            }
          >
            <SelectTrigger id="c-status" className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {CERT_STATUS_META[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="c-type" className="text-xs text-muted-foreground">
            Type
          </Label>
          <Select
            value={filters.type ?? "all"}
            onValueChange={(v) => setSearch({ type: v === "all" ? undefined : v })}
          >
            <SelectTrigger id="c-type" className="h-9 w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              {types.data?.types.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <form
          className="min-w-64 flex-1 space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch({ q: qDraft.trim() || undefined });
          }}
        >
          <Label htmlFor="c-q" className="text-xs text-muted-foreground">
            Recherche
          </Label>
          <Input
            id="c-q"
            className="h-9"
            placeholder="Identifiant, titulaire, référence, hash du document"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
          />
        </form>
      </div>

      <div className="overflow-x-auto rounded-md border bg-card">
        <div className="min-w-[960px]">
          <div
            className={cn(
              COLS,
              "border-b bg-muted/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground",
            )}
          >
            <span>Identifiant</span>
            <span>Type</span>
            <span>Titulaire</span>
            <span>Émis le</span>
            <span>Valide jusqu'au</span>
            <span>Statut</span>
          </div>
          {list.isPending ? (
            Array.from({ length: 10 }).map((_, i) => (
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
                  : "Impossible de charger les certificats."}
              </p>
              <Button variant="outline" size="sm" onClick={() => list.refetch()}>
                <RotateCw className="h-4 w-4" /> Réessayer
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {filters.q || filters.type || search.status
                ? "Aucun certificat ne correspond à ces critères."
                : "Aucun certificat émis pour le moment."}
            </p>
          ) : (
            <ul className={cn(list.isFetching && "opacity-70 transition-opacity")}>
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSearch({ id: c.id }, false)}
                    className={cn(
                      COLS,
                      "h-12 w-full border-b px-4 text-left text-sm hover:bg-accent/60 focus-visible:bg-accent",
                      search.id === c.id && "bg-accent",
                    )}
                  >
                    <span className="ref-mono truncate">{c.id}</span>
                    <span className="truncate">{c.typeName}</span>
                    <span className="truncate">{shortName(c.holderName)}</span>
                    <span className="text-muted-foreground">{formatDate(c.issuedAt)}</span>
                    <span className="text-muted-foreground">{formatDate(c.validUntil)}</span>
                    <span>
                      <CertificateStatusBadge status={c.status} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 text-sm">
        <span className="text-muted-foreground">
          Page {filters.page} sur {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={filters.page <= 1}
          onClick={() =>
            setSearch({ page: filters.page - 1 > 1 ? filters.page - 1 : undefined }, false)
          }
          aria-label="Page précédente"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={filters.page >= totalPages}
          onClick={() => setSearch({ page: filters.page + 1 }, false)}
          aria-label="Page suivante"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <CertificatePanel id={search.id} onClose={() => setSearch({ id: undefined }, false)} />
    </div>
  );
}
