import { useEffect } from "react";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/console/AppShell";
import { IdleTimeout } from "@/components/console/IdleTimeout";
import { auth, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_console")({
  component: ConsoleLayout,
});

function ConsoleLayout() {
  const s = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    void auth.boot();
  }, []);
  useEffect(() => {
    if (s.status === "anonymous") void navigate({ to: "/login" });
  }, [s.status, navigate]);

  if (s.status !== "authenticated") {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la session
        </span>
      </div>
    );
  }
  return (
    <AppShell>
      <IdleTimeout />
      <Outlet />
    </AppShell>
  );
}
