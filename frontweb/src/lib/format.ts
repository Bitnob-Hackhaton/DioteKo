export function formatSats(n: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(n).replace(/\u202f|\u00a0/g, " ")} sats`;
}

/** Prix éventuellement inconnu : « — » plutôt qu'un faux « 0 sats ». */
export function formatSatsOrDash(n: number | null): string {
  return n === null ? "—" : formatSats(n);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

export function formatAge(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} j`;
}

/** « Awa Diallo » -> « Awa D. » : affichage minimal d'un titulaire dans les listes et en-têtes. */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.`;
}

export const ENV =
  (import.meta.env["VITE_ENV"] as string | undefined) === "production" ? "production" : "sandbox";
// Données simulées uniquement si VITE_USE_MOCKS=true (par défaut : API réelle).
export const USE_MOCKS = (import.meta.env["VITE_USE_MOCKS"] as string | undefined) === "true";
