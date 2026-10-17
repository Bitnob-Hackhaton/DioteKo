import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, Loader2, RotateCw } from "lucide-react";
import { Can, Guard } from "@/components/console/Can";
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
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Search = {
  actor?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page?: number | undefined;
};

export const Route = createFileRoute("/_console/journal")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    actor: typeof s["actor"] === "string" && s["actor"] ? s["actor"] : undefined,
    from: typeof s["from"] === "string" && s["from"] ? s["from"] : undefined,
    to: typeof s["to"] === "string" && s["to"] ? s["to"] : undefined,
    page: Number(s["page"]) > 1 ? Number(s["page"]) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Journal d'audit — DioteKo Console" },
      {
        name: "description",
        content: "Historique horodaté des actions du personnel, consultable et exportable.",
      },
      { property: "og:title", content: "Journal d'audit — DioteKo Console" },
      {
        property: "og:description",
        content: "Historique horodaté des actions du personnel, consultable et exportable.",
      },
    ],
  }),
  component: () => (
    <Guard permission="audit.view">
      <AuditPage />
    </Guard>
  ),
});

const COLS =
  "grid grid-cols-[150px_minmax(140px,1fr)_minmax(160px,1.2fr)_minmax(180px,1.3fr)_minmax(180px,1.3fr)] items-center gap-4";

function AuditPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/journal" });
  const filters = { actor: search.actor, from: search.from, to: search.to, page: search.page ?? 1 };
  const setSearch = (patch: Partial<Search>, resetPage = true) =>
    void navigate({
      search: (prev) => ({ ...prev, ...(resetPage ? { page: undefined } : {}), ...patch }),
      replace: true,
    });
  const q = useQuery({
    queryKey: ["audit", filters],
    queryFn: () => api.audit(filters),
    placeholderData: keepPreviousData,
  });

  const exportCsv = useMutation({
    mutationFn: () => api.auditExport({ actor: filters.actor, from: filters.from, to: filters.to }),
    onSuccess: (rows) => {
      const csv = toCsv(
        ["Horodatage", "Acteur", "Rôle", "Action", "Objet"],
        rows.map((r) => [r.at, r.actorName, r.actorRole, r.action, r.object]),
      );
      downloadCsv(`journal-audit-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.success(`${rows.length} lignes exportées.`);
      void q.refetch();
    },
    onError: (e) => toast.error(isApiError(e) ? e.message : "Export impossible."),
  });

  const items = q.data?.items ?? [];
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Journal d'audit</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {q.data
              ? `${q.data.total} entrée${q.data.total > 1 ? "s" : ""} · consultation seule`
              : "\u00a0"}
          </p>
        </div>
        <Can permission="audit.export">
          <Button
            variant="outline"
            onClick={() => exportCsv.mutate()}
            disabled={exportCsv.isPending || !q.data?.total}
          >
            {exportCsv.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}{" "}
            Exporter en CSV
          </Button>
        </Can>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
        <div className="space-y-1">
          <Label htmlFor="a-actor" className="text-xs text-muted-foreground">
            Acteur
          </Label>
          <Select
            value={filters.actor ?? "all"}
            onValueChange={(v) => setSearch({ actor: v === "all" ? undefined : v })}
          >
            <SelectTrigger id="a-actor" className="h-9 w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les acteurs</SelectItem>
              {q.data?.actors.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="a-from" className="text-xs text-muted-foreground">
            Du
          </Label>
          <Input
            id="a-from"
            type="date"
            className="h-9 w-40"
            value={filters.from ?? ""}
            onChange={(e) => setSearch({ from: e.target.value || undefined })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="a-to" className="text-xs text-muted-foreground">
            Au
          </Label>
          <Input
            id="a-to"
            type="date"
            className="h-9 w-40"
            value={filters.to ?? ""}
            onChange={(e) => setSearch({ to: e.target.value || undefined })}
          />
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
            <span>Horodatage</span>
            <span>Acteur</span>
            <span>Rôle</span>
            <span>Action</span>
            <span>Objet</span>
          </div>
          {q.isPending ? (
            Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className={cn(COLS, "h-11 border-b px-4")}>
                {Array.from({ length: 5 }).map((__, j) => (
                  <Skeleton key={j} className="h-4" />
                ))}
              </div>
            ))
          ) : q.isError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-sm">
              <p className="text-status-danger">
                {isApiError(q.error) ? q.error.message : "Impossible de charger le journal."}
              </p>
              <Button variant="outline" size="sm" onClick={() => q.refetch()}>
                <RotateCw className="h-4 w-4" /> Réessayer
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Aucune entrée pour ces critères.
            </p>
          ) : (
            <ul className={cn(q.isFetching && "opacity-70 transition-opacity")}>
              {items.map((a) => (
                <li key={a.id} className={cn(COLS, "h-11 border-b px-4 text-sm last:border-0")}>
                  <span className="ref-mono text-xs text-muted-foreground">
                    {formatDateTime(a.at)}
                  </span>
                  <span className="truncate font-medium">{a.actorName}</span>
                  <span className="truncate text-muted-foreground">{a.actorRole}</span>
                  <span className="truncate">{a.action}</span>
                  <span className="ref-mono truncate text-xs">{a.object}</span>
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
    </div>
  );
}
