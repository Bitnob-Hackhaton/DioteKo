import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ChevronsLeft,
  ChevronsRight,
  FileCheck2,
  Inbox,
  ShieldCheck,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Search,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { auth, useUser } from "@/lib/auth";
import { ENV, USE_MOCKS } from "@/lib/format";
import { MOCK_USERS } from "@/lib/mocks";
import { actorsOf, can, ROLE_LABELS, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  icon: typeof Inbox;
  permission: Permission;
  to?: "/demandes" | "/verifications" | "/certificats" | "/tableau-de-bord" | "/journal";
  /** Screens backed by data the real API does not provide yet: only shown with simulated data. */
  mockOnly?: boolean;
};
const NAV: NavItem[] = [
  {
    label: "Tableau de bord",
    icon: LayoutDashboard,
    permission: "dashboard.view",
    to: "/tableau-de-bord",
    mockOnly: true,
  },
  { label: "Demandes", icon: Inbox, permission: "request.view", to: "/demandes" },
  {
    label: "Vérifications d'identité",
    icon: ShieldCheck,
    permission: "kyc.review",
    to: "/verifications",
  },
  {
    label: "Certificats",
    icon: FileCheck2,
    permission: "certificate.view",
    to: "/certificats",
    mockOnly: true,
  },
  { label: "Versements", icon: Wallet, permission: "payout.view" },
  {
    label: "Journal d'audit",
    icon: ScrollText,
    permission: "audit.view",
    to: "/journal",
    mockOnly: true,
  },
  { label: "Équipe", icon: Users, permission: "member.view" },
  { label: "Paramètres", icon: Settings, permission: "dashboard.view" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const user = useUser()!;
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const paid = useQuery({
    queryKey: ["requests", "paidCount"],
    queryFn: api.paidCount,
    enabled: can(user, "request.view"),
  });
  const roleLabel = actorsOf(user)
    .map((r) => ROLE_LABELS[r])
    .join(" · ");

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className={cn(
          "sticky top-0 flex h-screen shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width]",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded border border-primary/40 font-serif text-sm font-semibold text-primary">
            DK
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="font-serif text-base font-semibold">DioteKo</div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Console
              </div>
            </div>
          )}
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Navigation principale">
          {NAV.filter((n) => can(user, n.permission) && (USE_MOCKS || !n.mockOnly)).map((n) => {
            const Icon = n.icon;
            const inner = (
              <>
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
                {!collapsed && n.to === "/demandes" && paid.data ? (
                  <span
                    className="rounded bg-status-paid px-1.5 text-[11px] font-semibold text-primary-foreground"
                    aria-label={
                      USE_MOCKS
                        ? `${paid.data} demandes payées à traiter`
                        : `${paid.data} demandes à vérifier`
                    }
                  >
                    {paid.data}
                  </span>
                ) : null}
                {!collapsed && !n.to && (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Bientôt
                  </span>
                )}
              </>
            );
            const base = "flex h-9 items-center gap-3 rounded px-3 text-sm";
            return n.to ? (
              <Link
                key={n.label}
                to={n.to}
                title={collapsed ? n.label : undefined}
                className={cn(base, "hover:bg-sidebar-accent")}
                activeProps={{ className: "bg-sidebar-accent font-medium text-primary" }}
              >
                {inner}
              </Link>
            ) : (
              <span
                key={n.label}
                aria-disabled
                title={`${n.label} : prochaine itération`}
                className={cn(base, "cursor-not-allowed text-muted-foreground")}
              >
                {inner}
              </span>
            );
          })}
        </nav>
        <div className="space-y-2 border-t p-3">
          {!collapsed && (
            <div className="min-w-0 text-xs">
              <div className="truncate text-sm font-medium">{user.name}</div>
              <div className="mt-1 inline-block rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[11px] text-primary">
                {roleLabel}
              </div>
              <div className="mt-1 flex items-center gap-1 truncate text-muted-foreground">
                <Building2 className="h-3 w-3" aria-hidden /> {user.organization.name}
              </div>
            </div>
          )}
          {USE_MOCKS && !collapsed && (
            <div className="rounded border border-dashed border-status-waiting/50 p-2">
              <label
                className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-status-waiting"
                htmlFor="mock-switch"
              >
                Mode simulé : changer d'utilisateur
              </label>
              <Select
                value={user.id}
                onValueChange={async (id) => {
                  await auth.impersonate(id);
                  qc.clear();
                }}
              >
                <SelectTrigger id="mock-switch" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOCK_USERS.filter((u) => u.roles.length || u.platformRole).map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-xs">
                      {u.name} —{" "}
                      {actorsOf(u)
                        .map((r) => ROLE_LABELS[r])
                        .join(" + ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Déplier le menu" : "Replier le menu"}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <ChevronsLeft className="h-4 w-4" />
            )}
            {!collapsed && "Replier"}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b bg-background/95 px-6 backdrop-blur-sm">
          {/* The real list API has no text search yet (and holder names are not in the list by design): hidden there. */}
          {USE_MOCKS && (
          <form
            className="relative max-w-md flex-1"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              void navigate({
                to: "/demandes",
                search: { status: "all", q: search.trim() || undefined },
              });
            }}
          >
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Identifiant, hash de paiement, nom du titulaire"
              aria-label="Recherche globale"
              className="h-9 pl-9"
            />
          </form>
          )}
          {can(user, "org.switch") && (
            <Select defaultValue={user.organization.id}>
              <SelectTrigger className="h-9 w-56" aria-label="Changer d'organisation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={user.organization.id}>{user.organization.name}</SelectItem>
              </SelectContent>
            </Select>
          )}
          <div className="ml-auto flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "rounded border px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider",
                    ENV === "production"
                      ? "border-env-production text-env-production"
                      : "border-env-sandbox text-env-sandbox",
                  )}
                >
                  {ENV === "production" ? "PRODUCTION" : "SANDBOX"}
                </span>
              </TooltipTrigger>
              <TooltipContent>{USE_MOCKS ? "Données simulées" : "Connecté à l'API"}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Menu utilisateur">
                  {user.name
                    .split(" ")
                    .map((p) => p[0])
                    .join("")
                    .slice(0, 2)}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  <div className="font-medium">{user.name}</div>
                  <div className="text-xs font-normal text-muted-foreground">{user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    await auth.logout();
                    qc.clear();
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" /> Se déconnecter
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
