import { Ban, CheckCircle2, Hourglass } from "lucide-react";
import type { CertificateStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const CERT_STATUS_META: Record<
  CertificateStatus,
  { label: string; icon: typeof Ban; cls: string }
> = {
  valid: {
    label: "Valide",
    icon: CheckCircle2,
    cls: "text-status-valid border-status-valid/30 bg-status-valid/10",
  },
  expired: {
    label: "Expiré",
    icon: Hourglass,
    cls: "text-status-waiting border-status-waiting/30 bg-status-waiting/10",
  },
  revoked: {
    label: "Révoqué",
    icon: Ban,
    cls: "text-status-danger border-status-danger/30 bg-status-danger/10",
  },
};

export function CertificateStatusBadge({ status }: { status: CertificateStatus }) {
  const m = CERT_STATUS_META[status];
  const Icon = m.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium",
        m.cls,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {m.label}
    </span>
  );
}
