import {
  Banknote,
  CheckCircle2,
  CircleDashed,
  Clock,
  Cog,
  MessageSquareMore,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import type { RequestStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const STATUS_META: Record<
  RequestStatus,
  { label: string; icon: typeof Clock; cls: string }
> = {
  pending: {
    label: "À vérifier",
    icon: CircleDashed,
    cls: "text-status-neutral border-status-neutral/30 bg-status-neutral/5",
  },
  accepted: {
    label: "Acceptée, à payer",
    icon: ThumbsUp,
    cls: "text-status-paid border-status-paid/30 bg-status-paid/10",
  },
  needs_info: {
    label: "Complément demandé",
    icon: MessageSquareMore,
    cls: "text-status-waiting border-status-waiting/30 bg-status-waiting/10",
  },
  issuing: {
    label: "Génération en cours",
    icon: Cog,
    cls: "text-status-paid border-status-paid/30 bg-status-paid/10",
  },
  awaiting_payment: {
    label: "En attente de paiement",
    icon: Clock,
    cls: "text-status-waiting border-status-waiting/30 bg-status-waiting/10",
  },
  paid: {
    label: "Payée, à traiter",
    icon: Banknote,
    cls: "text-status-paid border-status-paid/30 bg-status-paid/10",
  },
  issued: {
    label: "Émise",
    icon: CheckCircle2,
    cls: "text-status-valid border-status-valid/30 bg-status-valid/10",
  },
  rejected: {
    label: "Refusée",
    icon: XCircle,
    cls: "text-status-danger border-status-danger/30 bg-status-danger/10",
  },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const m = STATUS_META[status];
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
