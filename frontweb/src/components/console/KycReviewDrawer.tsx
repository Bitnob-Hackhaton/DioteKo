import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RotateCw, XCircle } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, isApiError } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import type { KycDocumentKind, KycReviewDecision } from "@/lib/types";
import { KYC_REASON_LABELS } from "@/lib/kyc-labels";
import { KycOriginBadge, KycStatusBadge } from "./KycBadges";

const errMsg = (e: unknown) => (isApiError(e) ? e.message : "Erreur inattendue. Réessayez.");

const DOC_LABELS: Record<KycDocumentKind, string> = {
  front: "Recto",
  back: "Verso (MRZ)",
  selfie: "Selfie",
};

function DocumentViewer({ id, kind }: { id: string; kind: KycDocumentKind }) {
  const doc = useQuery({
    queryKey: ["kyc", "document", id, kind],
    queryFn: () => api.getKycDocument(id, kind),
    // Une pièce d'identité ne doit pas rester en cache : on la recharge à chaque ouverture.
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  // Les blob: URL sont libérées quand la vue se ferme.
  useEffect(() => {
    const url = doc.data;
    return () => {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [doc.data]);

  return (
    <figure className="space-y-1.5">
      <figcaption className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {DOC_LABELS[kind]}
      </figcaption>
      {doc.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : doc.isError ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm">
          <p className="px-4 text-center text-status-danger">{errMsg(doc.error)}</p>
          <Button variant="outline" size="sm" onClick={() => doc.refetch()}>
            <RotateCw className="h-4 w-4" /> Réessayer
          </Button>
        </div>
      ) : (
        <img
          src={doc.data}
          alt={`${DOC_LABELS[kind]} du dossier`}
          className="w-full rounded-md border bg-muted object-contain"
        />
      )}
    </figure>
  );
}

export function KycReviewDrawer({ id, onClose }: { id: string | undefined; onClose: () => void }) {
  const user = useUser();
  const qc = useQueryClient();
  const [decision, setDecision] = useState<KycReviewDecision | null>(null);
  const [note, setNote] = useState("");

  const q = useQuery({
    queryKey: ["kyc", "review", id],
    queryFn: () => api.getKycReview(id!),
    enabled: !!id,
  });

  const decide = useMutation({
    mutationFn: (d: KycReviewDecision) => api.decideKycReview(id!, d, note.trim()),
    onSuccess: (_r, d) => {
      toast.success(d === "approve" ? "Identité validée." : "Dossier rejeté.");
      setDecision(null);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["kyc"] });
    },
    onError: (e) => {
      toast.error(errMsg(e));
      // 409 = traité entre-temps par un autre agent : on rafraîchit l'état.
      if (isApiError(e) && e.statusCode === 409) {
        setDecision(null);
        void qc.invalidateQueries({ queryKey: ["kyc"] });
      }
    },
  });

  const r = q.data;
  const reviewable = !!r && r.status === "manual_review" && can(user, "kyc.review");
  const noteOk = note.trim().length >= 10;

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-serif">Vérification d'identité</SheetTitle>
          <SheetDescription>
            Comparez le document et le selfie, puis validez ou rejetez le dossier.
          </SheetDescription>
        </SheetHeader>

        {q.isPending ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : q.isError ? (
          <div className="flex flex-col items-center gap-3 p-8 text-sm">
            <p className="text-status-danger">{errMsg(q.error)}</p>
            <Button variant="outline" size="sm" onClick={() => q.refetch()}>
              <RotateCw className="h-4 w-4" /> Réessayer
            </Button>
          </div>
        ) : (
          r && (
            <div className="space-y-5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <code className="ref-mono text-sm">{r.reference}</code>
                <KycStatusBadge status={r.status} />
                <KycOriginBadge origin={r.origin} />
              </div>

              <dl className="space-y-2 rounded-md border p-4 text-sm">
                {(
                  [
                    ["Titulaire", r.holderName],
                    ["Pièce", r.documentType ?? "—"],
                    ["Pays émetteur", r.issuingCountry ?? "—"],
                    ["Déposé le", formatDateTime(r.createdAt)],
                    ["Tentatives", String(r.attempts)],
                    [
                      "Motif du renvoi en relecture",
                      r.failureReason
                        ? (KYC_REASON_LABELS[r.failureReason] ?? r.failureReason)
                        : "—",
                    ],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-right font-medium">{v}</dd>
                  </div>
                ))}
              </dl>

              {r.availableDocuments.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Aucune pièce disponible : elles ont expiré ou n'ont pas été conservées.
                </p>
              ) : (
                <div className="space-y-4">
                  {r.availableDocuments.map((k) => (
                    <DocumentViewer key={`${r.id}-${k}`} id={r.id} kind={k} />
                  ))}
                </div>
              )}

              {r.status !== "manual_review" && (
                <div className="rounded-md border bg-muted/40 p-4 text-sm">
                  <p className="font-medium">
                    Dossier traité{r.reviewedByName ? ` par ${r.reviewedByName}` : ""}
                    {r.reviewedAt ? `, le ${formatDateTime(r.reviewedAt)}` : ""}.
                  </p>
                  {r.reviewNote && <p className="mt-1 text-muted-foreground">{r.reviewNote}</p>}
                </div>
              )}

              {reviewable && (
                <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                  <Button
                    variant="outline"
                    className="border-status-danger/40 text-status-danger hover:bg-status-danger/5 hover:text-status-danger"
                    onClick={() => setDecision("reject")}
                  >
                    <XCircle className="h-4 w-4" /> Rejeter…
                  </Button>
                  <Button onClick={() => setDecision("approve")}>
                    <CheckCircle2 className="h-4 w-4" /> Valider l'identité…
                  </Button>
                </div>
              )}
            </div>
          )
        )}

        <Dialog
          open={!!decision}
          onOpenChange={(o) => !decide.isPending && !o && setDecision(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-serif">
                {decision === "approve" ? "Valider l'identité" : "Rejeter le dossier"}
              </DialogTitle>
              <DialogDescription>
                {decision === "approve"
                  ? "Le citoyen pourra demander et payer ses certificats. Cette décision est journalisée."
                  : "Le citoyen devra reprendre sa vérification. Cette décision est journalisée."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="kyc-note">Note de relecture (10 caractères minimum)</Label>
              <Textarea
                id="kyc-note"
                rows={4}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex. : nom et date de naissance concordants avec le selfie."
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" disabled={decide.isPending} onClick={() => setDecision(null)}>
                Annuler
              </Button>
              <Button
                variant={decision === "reject" ? "destructive" : "default"}
                disabled={!noteOk || decide.isPending}
                onClick={() => decision && decide.mutate(decision)}
              >
                {decide.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {decision === "approve" ? "Confirmer la validation" : "Confirmer le rejet"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
