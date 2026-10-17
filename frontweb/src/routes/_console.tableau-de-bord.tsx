import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Banknote, CheckCircle2, Coins, RotateCw, Timer } from "lucide-react";
import { Guard } from "@/components/console/Can";
import { StatusBadge } from "@/components/console/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, isApiError } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { formatAge, formatSats, shortName } from "@/lib/format";
import { can } from "@/lib/permissions";

export const Route = createFileRoute("/_console/tableau-de-bord")({
  head: () => ({
    meta: [
      { title: "Tableau de bord — DioteKo Console" },
      {
        name: "description",
        content: "Activité de l'organisation : demandes à traiter, émissions et encaissements.",
      },
      { property: "og:title", content: "Tableau de bord — DioteKo Console" },
      {
        property: "og:description",
        content: "Activité de l'organisation : demandes à traiter, émissions et encaissements.",
      },
    ],
  }),
  component: () => (
    <Guard permission="dashboard.view">
      <Dashboard />
    </Guard>
  ),
});

function formatDelay(m: number | null) {
  if (m === null) return "—";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")}`;
}

function Dashboard() {
  const user = useUser()!;
  const q = useQuery({ queryKey: ["stats"], queryFn: api.stats });
  const isFinance = user.roles.includes("finance_officer");
  const isAuditorOnly = user.roles.length === 1 && user.roles[0] === "auditor";
  const showMoney = !isAuditorOnly && (isFinance || can(user, "payout.view"));
  const showQueue = can(user, "request.view") && !isFinance;

  const cards = q.data
    ? [
        {
          label: "Payées à traiter",
          value: String(q.data.paidToProcess),
          icon: Banknote,
          tone: "text-status-paid",
          show: true,
        },
        {
          label: "Émises sur 30 jours",
          value: String(q.data.issued30d),
          icon: CheckCircle2,
          tone: "text-status-valid",
          show: true,
        },
        {
          label: "Encaissé sur 30 jours",
          value: formatSats(q.data.satsCollected30d),
          icon: Coins,
          tone: "text-status-waiting",
          show: showMoney,
        },
        {
          label: "Délai moyen paiement → émission",
          value: formatDelay(q.data.avgDelayMinutes),
          icon: Timer,
          tone: "text-foreground",
          show: true,
        },
      ].filter((c) => c.show)
    : [];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div>
        <h1 className="page-title">Tableau de bord</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user.organization.name}</p>
      </div>

      {q.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-md border bg-card py-16 text-sm">
          <p className="text-status-danger">
            {isApiError(q.error) ? q.error.message : "Impossible de charger les statistiques."}
          </p>
          <Button variant="outline" size="sm" onClick={() => q.refetch()}>
            <RotateCw className="h-4 w-4" /> Réessayer
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {q.isPending
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)
              : cards.map((c) => (
                  <div key={c.label} className="rounded-md border bg-card p-4">
                    <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {c.label}
                      <c.icon className={`h-4 w-4 ${c.tone}`} aria-hidden />
                    </div>
                    <p className="mt-3 font-serif text-3xl font-semibold tabular-nums">{c.value}</p>
                  </div>
                ))}
          </div>

          <section className="rounded-md border bg-card p-4">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Demandes des 30 derniers jours, par statut
            </h2>
            {q.isPending ? (
              <Skeleton className="h-[280px]" />
            ) : (
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={q.data.series.map((d) => ({
                      ...d,
                      label: d.date.slice(8, 10) + "/" + d.date.slice(5, 7),
                    }))}
                  >
                    <CartesianGrid vertical={false} stroke="var(--color-border)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      interval={2}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={28}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--color-accent)" }}
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                    <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="awaiting_payment"
                      name="En attente de paiement"
                      stackId="s"
                      fill="var(--color-status-waiting)"
                    />
                    <Bar
                      dataKey="paid"
                      name="Payée, à traiter"
                      stackId="s"
                      fill="var(--color-status-paid)"
                    />
                    <Bar
                      dataKey="issued"
                      name="Émise"
                      stackId="s"
                      fill="var(--color-status-valid)"
                    />
                    <Bar
                      dataKey="rejected"
                      name="Refusée"
                      stackId="s"
                      fill="var(--color-status-danger)"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {showQueue && (
            <section className="rounded-md border bg-card">
              <h2 className="border-b px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                À traiter maintenant
              </h2>
              {q.isPending ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-8" />
                  ))}
                </div>
              ) : q.data.oldestPaid.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Aucune demande payée à traiter.
                </p>
              ) : (
                <ul>
                  {q.data.oldestPaid.map((r) => (
                    <li
                      key={r.id}
                      className="grid grid-cols-[160px_1fr_1fr_170px_70px_auto] items-center gap-4 border-b px-4 py-2.5 text-sm last:border-0"
                    >
                      <span className="ref-mono">{r.reference}</span>
                      <span className="truncate">{r.typeName}</span>
                      <span className="truncate">{shortName(r.holderName)}</span>
                      <StatusBadge status={r.status} />
                      <span className="text-right tabular-nums text-muted-foreground">
                        {formatAge(r.paidAt ?? r.createdAt)}
                      </span>
                      <Button asChild size="sm" variant="secondary">
                        <Link to="/demandes" search={{ id: r.id }}>
                          Examiner
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
