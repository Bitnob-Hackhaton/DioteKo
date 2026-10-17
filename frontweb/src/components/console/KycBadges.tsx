import { CheckCircle2, Hourglass, XCircle } from "lucide-react";
import { KYC_ORIGIN_LABELS, KYC_STATUS_LABELS } from "@/lib/kyc-labels";
import type { KycReviewOrigin, KycReviewStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const BASE =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium";

const STATUS_STYLE: Record<KycReviewStatus, { icon: typeof Hourglass; cls: string }> = {
  manual_review: {
    icon: Hourglass,
    cls: "text-status-waiting border-status-waiting/30 bg-status-waiting/10",
  },
  verified: {
    icon: CheckCircle2,
    cls: "text-status-valid border-status-valid/30 bg-status-valid/10",
  },
  rejected: {
    icon: XCircle,
    cls: "text-status-danger border-status-danger/30 bg-status-danger/10",
  },
};

export function KycStatusBadge({ status }: { status: KycReviewStatus }) {
  const { icon: Icon, cls } = STATUS_STYLE[status];
  return (
    <span className={cn(BASE, cls)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {KYC_STATUS_LABELS[status]}
    </span>
  );
}

export function KycOriginBadge({ origin }: { origin: KycReviewOrigin }) {
  return (
    <span className={cn(BASE, "border-status-neutral/30 bg-status-neutral/5 text-status-neutral")}>
      {KYC_ORIGIN_LABELS[origin]}
    </span>
  );
}
