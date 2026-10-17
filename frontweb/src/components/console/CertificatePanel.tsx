import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Check, Copy, Loader2, RotateCw, ShieldCheck, ShieldX } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { CertificateStatusBadge } from "./CertificateStatusBadge";
import { api, isApiError } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { formatDate, formatDateTime, shortName } from "@/lib/format";
import type { Certificate, VerifyResult } from "@/lib/types";

const errMsg = (e: unknown) => (isApiError(e) ? e.message : "Erreur inattendue. Réessayez.");

function CopyMono({ value, label }: { value: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <span className="flex items-center gap-1">
      <code className="ref-mono min-w-0 flex-1 break-all text-xs">{value}</code>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        aria-label={`Copier ${label}`}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        }}
      >
        {ok ? (
          <Check className="h-3.5 w-3.5 text-status-valid" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </span>
  );
}

export function CertificatePanel({
  id,
  onClose,
}: {
  id?: string | undefined;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[520px]">
        {id && <PanelBody id={id} />}
      </SheetContent>
    </Sheet>
  );
}

function PanelBody({ id }: { id: string }) {
  const qc = useQueryClient();
  const canRevoke = useCan("certificate.revoke");
  const q = useQuery({ queryKey: ["certificate", id], queryFn: () => api.getCertificate(id) });
  const [hash, setHash] = useState("");
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);

  const verify = useMutation({
    mutationFn: () => api.verifyCertificate(id, hash.trim() || undefined),
    onSuccess: (r) => {
      setVerifyResult(r);
      toast[r.valid ? "success" : "warning"](
        r.valid ? "Certificat authentique et valide." : (r.reason ?? "Certificat non valide."),
      );
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const revoke = useMutation({
    mutationFn: (reason: string) => api.revokeCertificate(id, reason),
    onSuccess: () => {
      toast.success("Certificat révoqué.");
      setRevokeOpen(false);
      setVerifyResult(null);
      void qc.invalidateQueries({ queryKey: ["certificate", id] });
      void qc.invalidateQueries({ queryKey: ["certificates"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (q.isPending) {
    return (
      <div className="flex-1 p-6">
        <SheetHeader className="sr-only">
          <SheetTitle>Chargement</SheetTitle>
          <SheetDescription>Chargement du certificat</SheetDescription>
        </SheetHeader>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
        <SheetHeader className="sr-only">
          <SheetTitle>Erreur</SheetTitle>
          <SheetDescription>Erreur de chargement</SheetDescription>
        </SheetHeader>
        <p className="text-status-danger">{errMsg(q.error)}</p>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          <RotateCw className="h-4 w-4" /> Réessayer
        </Button>
      </div>
    );
  }
  const c = q.data;
  const simulated = c.anchor.txId === "simulated" || c.anchor.network === "simulé";

  return (
    <>
      <SheetHeader className="border-b px-6 py-4 text-left">
        <div className="flex flex-wrap items-center gap-3 pr-8">
          <SheetTitle className="ref-mono text-base">{c.id}</SheetTitle>
          <CertificateStatusBadge status={c.status} />
        </div>
        <SheetDescription>
          {c.typeName} · {shortName(c.holderName)} · demande{" "}
          <span className="ref-mono text-xs">{c.reference}</span>
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          <aside className="space-y-6 text-sm">
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Le document appartient au titulaire : il n'est ni affichable ni téléchargeable depuis
              la console. Seuls son état et son empreinte sont consultables.
            </p>
            {c.revocation && (
              <div className="rounded-md border border-status-danger/30 bg-status-danger/5 p-3">
                <p className="flex items-center gap-2 font-medium text-status-danger">
                  <Ban className="h-4 w-4" /> Révoqué par {c.revocation.byName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(c.revocation.at)}
                </p>
                <p className="mt-1">{c.revocation.reason}</p>
              </div>
            )}
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Informations
              </h2>
              <dl className="divide-y rounded-md border">
                <Row k="Émis le" v={formatDateTime(c.issuedAt)} />
                <Row k="Valide jusqu'au" v={formatDate(c.validUntil)} />
                {c.issuedBy && <Row k="Émis par" v={c.issuedBy} />}
              </dl>
            </section>
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Intégrité
              </h2>
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Hash du document
                  </p>
                  <CopyMono value={c.documentHash} label="le hash du document" />
                </div>
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Ancrage
                  </p>
                  {simulated ? (
                    <p className="text-status-waiting">Ancrage : simulé</p>
                  ) : (
                    <>
                      <p className="text-xs">
                        Réseau : {c.anchor.network}
                        {c.anchor.blockHeight ? ` · bloc ${c.anchor.blockHeight}` : ""}
                      </p>
                      <CopyMono value={c.anchor.txId} label="l'identifiant de transaction" />
                    </>
                  )}
                </div>
              </div>
            </section>
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Vérification
              </h2>
              <form
                className="space-y-2 rounded-md border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!verify.isPending) verify.mutate();
                }}
              >
                <Label htmlFor="v-hash" className="text-xs text-muted-foreground">
                  Hash à comparer (facultatif)
                </Label>
                <Input
                  id="v-hash"
                  className="ref-mono h-9 text-xs"
                  value={hash}
                  onChange={(e) => setHash(e.target.value)}
                  placeholder="Laisser vide pour vérifier le statut"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  disabled={verify.isPending}
                >
                  {verify.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}{" "}
                  Vérifier
                </Button>
                {verifyResult && (
                  <div
                    role="status"
                    className={
                      "mt-2 flex gap-2 rounded border p-2 text-xs " +
                      (verifyResult.valid
                        ? "border-status-valid/30 bg-status-valid/5 text-status-valid"
                        : "border-status-danger/30 bg-status-danger/5 text-status-danger")
                    }
                  >
                    {verifyResult.valid ? (
                      <ShieldCheck className="h-4 w-4 shrink-0" />
                    ) : (
                      <ShieldX className="h-4 w-4 shrink-0" />
                    )}
                    <span>
                      {verifyResult.valid
                        ? `Authentique et valide jusqu'au ${formatDate(verifyResult.expiresAt)}.`
                        : (verifyResult.reason ?? "Non valide.")}
                    </span>
                  </div>
                )}
              </form>
            </section>
          </aside>
        </div>
      </div>

      {canRevoke && c.status !== "revoked" && (
        <div className="sticky bottom-0 flex justify-end border-t bg-card px-6 py-3">
          <Button
            variant="outline"
            className="border-status-danger/40 text-status-danger hover:bg-status-danger/5 hover:text-status-danger"
            onClick={() => setRevokeOpen(true)}
          >
            <Ban className="h-4 w-4" /> Révoquer…
          </Button>
        </div>
      )}

      <RevokeDialog
        cert={c}
        open={revokeOpen}
        pending={revoke.isPending}
        onClose={() => setRevokeOpen(false)}
        onSubmit={(r) => revoke.mutate(r)}
      />
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 px-3 py-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}

function RevokeDialog({
  cert,
  open,
  pending,
  onClose,
  onSubmit,
}: {
  cert: Certificate;
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (r: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const ok = reason.trim().length >= 10 && confirm.trim() === cert.id;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !pending) {
          setReason("");
          setConfirm("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif">Révoquer le certificat</DialogTitle>
          <DialogDescription>
            La révocation est définitive. Toute vérification ultérieure indiquera que ce certificat
            n'est plus valide.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rv-reason">Motif (10 caractères minimum)</Label>
            <Textarea
              id="rv-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rv-confirm">
              Saisissez <span className="ref-mono">{cert.id}</span> pour confirmer
            </Label>
            <Input
              id="rv-confirm"
              className="ref-mono"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button
            variant="destructive"
            disabled={!ok || pending}
            onClick={() => onSubmit(reason.trim())}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} Révoquer définitivement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
