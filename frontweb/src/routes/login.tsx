import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { AuthIllustration } from "@/components/console/AuthIllustration";
import { auth, useAuth } from "@/lib/auth";
import { isApiError } from "@/lib/api";
import { ENV, USE_MOCKS } from "@/lib/format";
import { MOCK_USERS } from "@/lib/mocks";
import { actorsOf, ROLE_LABELS } from "@/lib/permissions";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Connexion — DioteKo Console" },
      {
        name: "description",
        content: "Connexion réservée au personnel habilité des organisations émettrices.",
      },
      { property: "og:title", content: "Connexion — DioteKo Console" },
      {
        property: "og:description",
        content: "Connexion réservée au personnel habilité des organisations émettrices.",
      },
    ],
  }),
  component: LoginPage,
});

const schema = z.object({
  email: z.string().email("Adresse e-mail invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

const REASONS = {
  expired: "Session expirée. Veuillez vous reconnecter.",
  not_staff: "Accès réservé au personnel habilité.",
  idle: "Vous avez été déconnecté après 15 minutes d'inactivité.",
} as const;

function LoginPage() {
  const s = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    void auth.boot();
  }, []);
  useEffect(() => {
    if (s.status === "authenticated")
      void navigate({ to: USE_MOCKS ? "/tableau-de-bord" : "/demandes" });
  }, [s.status, navigate]);

  const reason = s.status === "anonymous" && s.reason ? REASONS[s.reason] : null;

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      await auth.login(email, password);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Connexion impossible. Vérifiez votre réseau.");
    }
  });

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-foreground text-background lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded border border-background/40 font-serif text-base font-semibold">
            DK
          </div>
          <span className="font-serif text-lg font-semibold tracking-tight">DioteKo Console</span>
        </div>

        <div className="space-y-8">
          <AuthIllustration className="mx-auto w-full max-w-md text-background" />
          <div className="max-w-md space-y-4">
            <h2 className="font-serif text-3xl font-semibold leading-tight">
              Des certificats administratifs que chacun peut vérifier.
            </h2>
            <ul className="space-y-2 text-sm text-background/80">
              <li className="flex gap-2">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                Demandes examinées par l'agent de votre organisation
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                Paiement Bitcoin Lightning, émission automatique ensuite
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                Chaque certificat porte un QR de vérification publique
              </li>
            </ul>
          </div>
        </div>

        <p className="font-mono text-[11px] tracking-wider text-background/60">
          {ENV === "production" ? "PRODUCTION" : "SANDBOX"}
        </p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="grid h-11 w-11 place-items-center rounded border border-primary/40 font-serif text-lg font-semibold text-primary lg:hidden">
              DK
            </div>
            <h1 className="page-title mt-4 lg:mt-0">Connexion</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Espace réservé au personnel des organisations émettrices
            </p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {(error || reason) && (
              <div
                role="alert"
                className="flex gap-2 rounded border border-status-danger/30 bg-status-danger/5 p-3 text-sm text-status-danger"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {error ?? reason}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Adresse e-mail</Label>
              <Input id="email" type="email" autoComplete="username" {...form.register("email")} />
              {form.formState.errors.email && (
                <p className="text-xs text-status-danger">{form.formState.errors.email.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mot de passe</Label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                {...form.register("password")}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-status-danger">
                  {form.formState.errors.password.message}
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Se connecter
            </Button>
          </form>

          {USE_MOCKS && (
            <div className="mt-6 rounded-md border border-dashed border-status-waiting/50 p-4 text-xs">
              <p className="font-semibold uppercase tracking-wider text-status-waiting">
                Mode simulé · mot de passe « demo »
              </p>
              <ul className="mt-2 space-y-1">
                {MOCK_USERS.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="w-full rounded px-1 py-0.5 text-left hover:bg-accent"
                      onClick={() => {
                        form.setValue("email", u.email);
                        form.setValue("password", "demo");
                      }}
                    >
                      <span className="ref-mono text-xs">{u.email}</span>
                      <span className="block text-muted-foreground">
                        {actorsOf(u)
                          .map((r) => ROLE_LABELS[r])
                          .join(" + ") || "Citoyen (sans rôle)"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-6 font-mono text-[11px] tracking-wider text-muted-foreground lg:hidden">
            {ENV === "production" ? "PRODUCTION" : "SANDBOX"}
          </p>
        </div>
      </main>
    </div>
  );
}
