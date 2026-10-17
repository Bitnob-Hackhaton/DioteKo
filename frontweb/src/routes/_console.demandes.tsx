import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { Guard } from "@/components/console/Can";
import { StatusBadge, STATUS_META } from "@/components/console/StatusBadge";
import { RequestDrawer } from "@/components/console/RequestDrawer";
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
import { formatAge, formatDate, formatSatsOrDash, shortName, USE_MOCKS } from "@/lib/format";
import type { RequestStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type Search = {
  status?: RequestStatus | "all" | undefined;
  type?: string | undefined;
  q?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page?: number | undefined;
  id?: string | undefined;
};
// Simulated data keeps the old vocabulary (payment first); the real flow starts with the agent's verification.
const STATUSES = USE_MOCKS
  ? (["paid", "awaiting_payment", "issued", "rejected", "pending"] as const)
  : ([
      "pending",
      "needs_info",
      "accepted",
      "awaiting_payment",
      "paid",
      "issuing",
      "issued",
      "rejected",
    ] as const);
const DEFAULT_STATUS = USE_MOCKS ? "paid" : "pending";

export const Route = createFileRoute("/_console/demandes")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    status: [...(STATUSES as readonly string[]), "all"].includes(s["status"] as string)
      ? (s["status"] as Search["status"])
      : undefined,
    type: typeof s["type"] === "string" && s["type"] ? s["type"] : undefined,
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    from: typeof s["from"] === "string" && s["from"] ? s["from"] : undefined,
    to: typeof s["to"] === "string" && s["to"] ? s["to"] : undefined,
    page: Number(s["page"]) > 1 ? Number(s["page"]) : undefined,
    id: typeof s["id"] === "string" && s["id"] ? s["id"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Demandes — DioteKo Console" },
      { name: "description", content: "Demandes de certificats à examiner, émettre ou refuser." },
      { property: "og:title", content: "Demandes — DioteKo Console" },
      {
        property: "og:description",
        content: "Demandes de certificats à examiner, émettre ou refuser.",
      },
    ],
  }),
  component: () => (
    <Guard permission="request.view">
      <RequestsPage />
    </Guard>
  ),
});

const COLS =
  "grid grid-cols-[minmax(150px,1.1fr)_minmax(170px,1.4fr)_minmax(140px,1.2fr)_110px_110px_190px_60px] items-center gap-4";

function RequestsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/demandes" });
  const filters = {
    status: search.status ?? DEFAULT_STATUS,
    type: search.type,
    q: search.q,
    from: search.from,
    to: search.to,
    page: search.page ?? 1,
  };
  const setSearch = (patch: Partial<Search>, resetPage = true) =>
    void navigate({
      search: (prev) => ({ ...prev, ...(resetPage ? { page: undefined } : {}), ...patch }),
      replace: true,
    });

  const types = useQuery({ queryKey: ["types"], queryFn: api.types, staleTime: Infinity });
  const list = useQuery({
    queryKey: ["requests", "list", filters],
    queryFn: () => api.listRequests(filters),
    placeholderData: keepPreviousData,
  });
  const [qDraft, setQDraft] = useState(search.q ?? "");
  useEffect(() => {
    setQDraft(search.q ?? "");
  }, [search.q]);

  // keyboard navigation
  const [cursor, setCursor] = useState(0);
  const items = list.data?.items ?? [];
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    setCursor(0);
  }, [list.data?.page, filters.status, filters.q, filters.type]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (search.id) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [role=combobox], [role=dialog]")) return;
      if (e.key === "j") setCursor((c) => Math.min(c + 1, items.length - 1));
      else if (e.key === "k") setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === "Enter" && items[cursor] && !t.closest("button, a"))
        setSearch({ id: items[cursor].id }, false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // Block body on purpose: an effect must return a cleanup function or nothing, never the call's result.
  // Block body on purpose: an effect must return a cleanup function or nothing, never the call's result.
  // Block body on purpose: an effect must return a cleanup function or nothing, never the call's result
  // (scrollIntoView can return a Promise when patched by a polyfill or extension).
  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Demandes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {list.data ? `${list.data.total} demande${list.data.total > 1 ? "s" : ""}` : "\u00a0"}
            <span className="ml-3 hidden text-xs lg:inline">
              Raccourcis : j / k pour se déplacer, Entrée pour ouvrir
            </span>
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
        <div className="space-y-1">
          <Label htmlFor="f-status" className="text-xs text-muted-foreground">
            Statut
          </Label>
          <Select
            value={filters.status}
            onValueChange={(v) =>
              setSearch({ status: v === DEFAULT_STATUS ? undefined : (v as Search["status"]) })
            }
          >
            <SelectTrigger id="f-status" className="h-9 w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_META[s].label}
                </SelectItem>
              ))}
              <SelectItem value="all">Tous les statuts</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Type, dates and search are not filterable on the real API yet: shown with simulated data only. */}
        {USE_MOCKS && (
          <>
            <div className="space-y-1">
              <Label htmlFor="f-type" className="text-xs text-muted-foreground">
                Type
              </Label>
              <Select
                value={filters.type ?? "all"}
                onValueChange={(v) => setSearch({ type: v === "all" ? undefined : v })}
              >
                <SelectTrigger id="f-type" className="h-9 w-60">
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
            <div className="space-y-1">
              <Label htmlFor="f-from" className="text-xs text-muted-foreground">
                Du
              </Label>
              <Input
                id="f-from"
                type="date"
                className="h-9 w-40"
                value={filters.from ?? ""}
                onChange={(e) => setSearch({ from: e.target.value || undefined })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-to" className="text-xs text-muted-foreground">
                Au
              </Label>
              <Input
                id="f-to"
                type="date"
                className="h-9 w-40"
                value={filters.to ?? ""}
                onChange={(e) => setSearch({ to: e.target.value || undefined })}
              />
            </div>
            <form
              className="min-w-56 flex-1 space-y-1"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch({ q: qDraft.trim() || undefined });
              }}
            >
              <Label htmlFor="f-q" className="text-xs text-muted-foreground">
                Recherche
              </Label>
              <Input
                id="f-q"
                className="h-9"
                placeholder="Référence, titulaire, hash"
                value={qDraft}
                onChange={(e) => setQDraft(e.target.value)}
              />
            </form>
          </>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border bg-card">
        <div className="min-w-[1000px]">
          <div
            className={cn(
              COLS,
              "border-b bg-muted/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground",
            )}
          >
            <span>Référence</span>
            <span>Type</span>
            <span>Titulaire</span>
            <span>Date</span>
            <span className="text-right">Montant</span>
            <span>Statut</span>
            <span className="text-right">Âge</span>
          </div>

          {list.isPending ? (
            Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className={cn(COLS, "h-12 border-b px-4 last:border-0")}>
                {Array.from({ length: 7 }).map((__, j) => (
                  <Skeleton key={j} className="h-4" />
                ))}
              </div>
            ))
          ) : list.isError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-sm">
              <p className="text-status-danger">
                {isApiError(list.error)
                  ? list.error.message
                  : "Impossible de charger les demandes."}
              </p>
              <Button variant="outline" size="sm" onClick={() => list.refetch()}>
                <RotateCw className="h-4 w-4" /> Réessayer
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {filters.status === DEFAULT_STATUS && !filters.q && !filters.type
                ? USE_MOCKS
                  ? "Aucune demande payée à traiter."
                  : "Aucune demande à vérifier."
                : "Aucune demande ne correspond à ces critères."}
            </p>
          ) : (
            <ul className={cn(list.isFetching && "opacity-70 transition-opacity")}>
              {items.map((r, i) => (
                <li key={r.id}>
                  <button
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    type="button"
                    onClick={() => {
                      setCursor(i);
                      setSearch({ id: r.id }, false);
                    }}
                    className={cn(
                      COLS,
                      "h-12 w-full border-b px-4 text-left text-sm hover:bg-accent/60 focus-visible:bg-accent",
                      i === cursor && "bg-accent/70 shadow-[inset_2px_0_0_var(--color-primary)]",
                      search.id === r.id && "bg-accent",
                    )}
                    aria-current={i === cursor ? "true" : undefined}
                  >
                    <span className="ref-mono truncate">{r.reference}</span>
                    <span className="truncate">{r.typeName}</span>
                    <span className="truncate">{shortName(r.holderName)}</span>
                    <span className="text-muted-foreground">{formatDate(r.createdAt)}</span>
                    <span className="text-right tabular-nums">{formatSatsOrDash(r.amountSats)}</span>
                    <span>
                      <StatusBadge status={r.status} />
                    </span>
                    <span className="text-right tabular-nums text-muted-foreground">
                      {formatAge(r.paidAt ?? r.createdAt)}
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

      <RequestDrawer id={search.id} onClose={() => setSearch({ id: undefined }, false)} />
    </div>
  );
}
