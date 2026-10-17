import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { useCan } from "@/lib/auth";
import { rolesFor, type Permission } from "@/lib/permissions";

export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useCan(permission) ? <>{children}</> : <>{fallback}</>;
}

export function Forbidden({ permission }: { permission: Permission }) {
  return (
    <div className="mx-auto mt-24 max-w-md rounded-md border bg-card p-8 text-center">
      <ShieldAlert className="mx-auto h-8 w-8 text-status-danger" aria-hidden />
      <h1 className="page-title mt-4 text-xl">Vous n'avez pas accès à cette page</h1>
      <p className="mt-2 text-sm text-muted-foreground">Rôle requis : {rolesFor(permission)}.</p>
    </div>
  );
}

/** Route-level guard: renders the page only if the permission is granted. */
export function Guard({ permission, children }: { permission: Permission; children: ReactNode }) {
  return useCan(permission) ? <>{children}</> : <Forbidden permission={permission} />;
}
