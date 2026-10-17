import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  Copy,
  FileCheck2,
  Loader2,
  MessageSquare,
  MessageSquareMore,
  RotateCw,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
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
import { StatusBadge } from "./StatusBadge";
import { api, isApiError } from "@/lib/api";
import { useUser } from "@/lib/auth";
import { can, ROLE_LABELS, violatesFourEyes } from "@/lib/permissions";
import { formatDate, formatDateTime, formatSatsOrDash, USE_MOCKS } from "@/lib/format";
import type { CertificateRequestDetail, IssueResult } from "@/lib/types";

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

type ReasonMode = { kind: "recommend_reject" | "reject" | "request_info" } | null;

export function RequestDrawer({ id, onClose }: { id?: string | undefined; onClose: () => void }) {
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[960px]">
        {id && <DrawerBody id={id} />}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ id }: { id: string }) {
  const user = useUser()!;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["request", id], queryFn: () => api.getRequest(id) });
  const [reason, setReason] = useState<ReasonMode>(null);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [issued, setIssued] = useState<IssueResult | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["request", id] });
    void qc.invalidateQueries({ queryKey: ["requests"] });
  };
  const onError = (e: unknown) => toast.error(errMsg(e));

  const recommend = useMutation({
    mutationFn: (v: { decision: "issue" | "reject"; reason?: string }) =>
      api.recommend(id, v.decision, v.reason),
    onSuccess: (_d, v) => {
      toast.success(v.decision === "issue" ? "Émission recommandée." : "Refus recommandé.");
      setReason(null);
      refresh();
    },
    onError,
  });
  const issue = useMutation({
    mutationFn: () => api.issue(id),
    onSuccess: (r) => {
      toast.success(`Certificat ${r.certificateId} émis.`);
      setConfirmIssue(false);
      setIssued(r);
      refresh();
    },
    onError,
  });
  const reject = useMutation({
    mutationFn: (r: string) => api.reject(id, r),
    onSuccess: () => {
      toast.success("Demande refusée.");
      setReason(null);
      refresh();
    },
    onError,
  });
  const accept = useMutation({
    mutationFn: () => api.accept(id),
    onSuccess: () => {
      toast.success("Demande acceptée : le citoyen peut maintenant payer.");
      refresh();
    },
    onError,
  });
  const requestInfo = useMutation({
    mutationFn: (message: string) => api.requestInfo(id, message),
    onSuccess: () => {
      toast.success("Complément demandé au citoyen.");
      setReason(null);
      refresh();
    },
    onError,
  });

  if (q.isPending) {
    return (
      <div className="space-y-4 p-6">
        <SheetHeader className="sr-only">
          <SheetTitle>Chargement</SheetTitle>
          <SheetDescription>Chargement de la demande</SheetDescription>
        </SheetHeader>
        <Skeleton className="h-7 w-64" />
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
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

  const r = q.data;
  const result = issued ?? r.issued ?? null;
  const isPaid = r.status === "paid";
  const canSeePersonalData = can(user, "request.view_personal_data");
  const fourEyes = violatesFourEyes(user.id, r.recommendation?.byId);
  // Simulated data: recommendation then manual issuance. Real API: the agent accepts, rejects or asks for more
  // information; the certificate is generated by the server once the citizen has paid.
  const showRecommend = USE_MOCKS && isPaid && can(user, "request.recommend");
  const showDecide =
    USE_MOCKS && isPaid && (can(user, "request.issue") || can(user, "request.reject"));
  const reviewable = !USE_MOCKS && r.status === "pending" && can(user, "request.reject");
  const busy = accept.isPending || reject.isPending || requestInfo.isPending;

  return (
    <>
      <SheetHeader className="border-b px-6 py-4 text-left">
        <div className="flex flex-wrap items-center gap-3 pr-8">
          <SheetTitle className="ref-mono text-base">{r.reference}</SheetTitle>
          <StatusBadge status={r.status} />
        </div>
        <SheetDescription>
          {r.typeName} · {formatSatsOrDash(r.amountSats)} · déposée le {formatDateTime(r.createdAt)}
          {r.certificateId && (
            <>
              {" "}
              · certificat <span className="ref-mono">{r.certificateId}</span>
            </>
          )}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="grid gap-8 p-6 lg:grid-cols-[1fr_340px]">
          <section aria-labelledby="sd-title">
            <h2
              id="sd-title"
              className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Données soumises
            </h2>
            {canSeePersonalData ? (
              <dl className="divide-y rounded-md border">
                {Object.entries(r.submittedData).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[180px_1fr] gap-4 px-4 py-2.5 text-sm">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="break-words font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Les données personnelles du titulaire ne sont pas affichées pour votre rôle.
              </p>
            )}

            {r.recommendation && (
              <div className="mt-4 rounded-md border border-status-paid/30 bg-status-paid/5 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-status-paid">
                  {r.recommendation.decision === "issue" ? (
                    <ThumbsUp className="h-4 w-4" />
                  ) : (
                    <ThumbsDown className="h-4 w-4" />
                  )}
                  {r.recommendation.decision === "issue"
                    ? "Émission recommandée"
                    : "Refus recommandé"}{" "}
                  par {r.recommendation.byName}
                </p>
                {r.recommendation.reason && (
                  <p className="mt-1 text-muted-foreground">Motif : {r.recommendation.reason}</p>
                )}
              </div>
            )}
            {r.rejectionReason && (
              <div className="mt-4 rounded-md border border-status-danger/30 bg-status-danger/5 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-status-danger">
                  <XCircle className="h-4 w-4" /> Motif du refus
                </p>
                <p className="mt-1">{r.rejectionReason}</p>
              </div>
            )}
            {r.infoRequest && (
              <div className="mt-4 rounded-md border border-status-waiting/30 bg-status-waiting/5 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium text-status-waiting">
                  <MessageSquareMore className="h-4 w-4" /> Complément demandé au citoyen
                </p>
                <p className="mt-1">{r.infoRequest}</p>
              </div>
            )}
            {!USE_MOCKS && r.status === "accepted" && (
              <p className="mt-4 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Demande acceptée. Le citoyen peut payer ; le certificat sera généré automatiquement
                dès le paiement constaté.
              </p>
            )}
            {result && <IssuedCard result={result} />}

            {USE_MOCKS && <Notes r={r} />}
          </section>

          <aside aria-labelledby="tl-title">
            <h2
              id="tl-title"
              className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Historique
            </h2>
            <ol className="relative space-y-5 border-l pl-5">
              {r.timeline.map((t, i) => (
                <li key={i} className="relative">
                  <span
                    className={
                      "absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background " +
                      (t.kind === "rejected"
                        ? "bg-status-danger"
                        : t.kind === "issued"
                          ? "bg-status-valid"
                          : t.kind === "paid"
                            ? "bg-status-paid"
                            : "bg-status-neutral")
                    }
                    aria-hidden
                  />
                  <p className="text-sm font-medium">
                    {t.label}
                    {t.actor ? ` par ${t.actor}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(t.at)}</p>
                  {t.kind === "paid" && r.paymentHash && (
                    <div className="mt-1.5 rounded border bg-muted/50 p-2">
                      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Hash de paiement
                      </p>
                      <CopyMono value={r.paymentHash} label="le hash de paiement" />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </div>

      {reviewable && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t bg-card px-6 py-3">
          <Button
            variant="outline"
            className="border-status-danger/40 text-status-danger hover:bg-status-danger/5 hover:text-status-danger"
            onClick={() => setReason({ kind: "reject" })}
            disabled={busy}
          >
            <XCircle className="h-4 w-4" /> Refuser…
          </Button>
          <Button
            variant="outline"
            onClick={() => setReason({ kind: "request_info" })}
            disabled={busy}
          >
            <MessageSquareMore className="h-4 w-4" /> Demander un complément…
          </Button>
          <Button onClick={() => accept.mutate()} disabled={busy}>
            {accept.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ThumbsUp className="h-4 w-4" />
            )}{" "}
            Accepter la demande
          </Button>
        </div>
      )}

      {(showRecommend || showDecide) && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t bg-card px-6 py-3">
          {showDecide && fourEyes && (
            <p className="mr-auto text-xs text-status-waiting">
              Règle des quatre yeux : vous avez recommandé cette demande, un autre officier doit
              décider.
            </p>
          )}
          {showRecommend && (
            <>
              <Button
                variant="outline"
                onClick={() => setReason({ kind: "recommend_reject" })}
                disabled={recommend.isPending}
              >
                <ThumbsDown className="h-4 w-4" /> Recommander le refus
              </Button>
              <Button
                variant="secondary"
                onClick={() => recommend.mutate({ decision: "issue" })}
                disabled={recommend.isPending}
              >
                {recommend.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ThumbsUp className="h-4 w-4" />
                )}{" "}
                Recommander l'émission
              </Button>
            </>
          )}
          {showDecide && !fourEyes && (
            <>
              {can(user, "request.reject") && (
                <Button
                  variant="outline"
                  className="border-status-danger/40 text-status-danger hover:bg-status-danger/5 hover:text-status-danger"
                  onClick={() => setReason({ kind: "reject" })}
                >
                  <XCircle className="h-4 w-4" /> Refuser…
                </Button>
              )}
              {can(user, "request.issue") && (
                <Button onClick={() => setConfirmIssue(true)}>
                  <FileCheck2 className="h-4 w-4" /> Émettre le certificat
                </Button>
              )}
            </>
          )}
        </div>
      )}

      <Dialog open={confirmIssue} onOpenChange={(o) => !issue.isPending && setConfirmIssue(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif">Émettre le certificat</DialogTitle>
            <DialogDescription>
              Cette action est irréversible. Le certificat sera signé et ancré.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 rounded-md border p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Titulaire</dt>
              <dd className="font-medium">{r.holderName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Type</dt>
              <dd className="font-medium">{r.typeName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Référence</dt>
              <dd className="ref-mono">{r.reference}</dd>
            </div>
          </dl>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmIssue(false)}
              disabled={issue.isPending}
            >
              Annuler
            </Button>
            <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
              {issue.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Confirmer l'émission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        mode={reason}
        pending={recommend.isPending || reject.isPending || requestInfo.isPending}
        onClose={() => setReason(null)}
        onSubmit={(text) =>
          reason?.kind === "reject"
            ? reject.mutate(text)
            : reason?.kind === "request_info"
              ? requestInfo.mutate(text)
              : recommend.mutate({ decision: "reject", reason: text })
        }
      />
    </>
  );
}

function IssuedCard({ result }: { result: IssueResult }) {
  return (
    <div className="mt-4 rounded-md border border-status-valid/40 bg-status-valid/5 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium text-status-valid">
        <FileCheck2 className="h-4 w-4" /> Certificat émis
      </p>
      <dl className="mt-3 space-y-2">
        <div className="grid grid-cols-[150px_1fr] gap-2">
          <dt className="text-muted-foreground">Identifiant</dt>
          <dd className="ref-mono">{result.certificateId}</dd>
        </div>
        <div className="grid grid-cols-[150px_1fr] gap-2">
          <dt className="text-muted-foreground">Hash du document</dt>
          <dd>
            <CopyMono value={result.documentHash} label="le hash du document" />
          </dd>
        </div>
        <div className="grid grid-cols-[150px_1fr] gap-2">
          <dt className="text-muted-foreground">Valide jusqu'au</dt>
          <dd>{formatDate(result.validUntil)}</dd>
        </div>
        <div className="grid grid-cols-[150px_1fr] gap-2">
          <dt className="text-muted-foreground">Ancrage</dt>
          <dd>
            {result.blockchainAnchor.txId === "simulated" ? (
              "Ancrage : simulé"
            ) : (
              <span className="ref-mono">
                {result.blockchainAnchor.network} · {result.blockchainAnchor.txId}
              </span>
            )}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Le document est remis au titulaire dans son application. Il n'est pas consultable depuis la
        console.
      </p>
    </div>
  );
}

function Notes({ r }: { r: CertificateRequestDetail }) {
  const user = useUser()!;
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const add = useMutation({
    mutationFn: () => api.addNote(r.id, body.trim()),
    onSuccess: () => {
      toast.success("Note ajoutée.");
      setBody("");
      void qc.invalidateQueries({ queryKey: ["request", r.id] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <section className="mt-8" aria-labelledby="notes-title">
      <h2
        id="notes-title"
        className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        <MessageSquare className="h-3.5 w-3.5" /> Notes internes
      </h2>
      {r.notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune note.</p>
      ) : (
        <ul className="space-y-3">
          {r.notes.map((n) => (
            <li key={n.id} className="rounded-md border p-3 text-sm">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{n.authorName}</span> ·{" "}
                {ROLE_LABELS[n.authorRole]} · {formatDateTime(n.at)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      {can(user, "request.note") && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim() && !add.isPending) add.mutate();
          }}
        >
          <Label htmlFor="note" className="sr-only">
            Nouvelle note
          </Label>
          <Textarea
            id="note"
            rows={2}
            maxLength={1000}
            placeholder="Ajouter une note interne"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={!body.trim() || add.isPending}
            >
              {add.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Ajouter la note
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function ReasonDialog({
  mode,
  pending,
  onClose,
  onSubmit,
}: {
  mode: ReasonMode;
  pending: boolean;
  onClose: () => void;
  onSubmit: (r: string) => void;
}) {
  const [text, setText] = useState("");
  const ok = text.trim().length >= 10;
  const definitive = mode?.kind === "reject";
  const asksInfo = mode?.kind === "request_info";
  return (
    <Dialog
      open={!!mode}
      onOpenChange={(o) => {
        if (!o && !pending) {
          setText("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif">
            {asksInfo
              ? "Demander un complément"
              : definitive
                ? "Refuser la demande"
                : "Recommander le refus"}
          </DialogTitle>
          <DialogDescription>
            {asksInfo
              ? "Le citoyen verra ce message, corrigera sa demande puis la renverra pour une nouvelle vérification."
              : definitive
                ? "Le refus est définitif. Le motif sera communiqué au citoyen."
                : "Un officier signataire prendra la décision finale."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reason">
            {asksInfo ? "Message au citoyen" : "Motif"} (10 caractères minimum)
          </Label>
          <Textarea
            id="reason"
            rows={4}
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{text.trim().length} / 10 minimum</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Annuler
          </Button>
          <Button
            variant={definitive ? "destructive" : "default"}
            disabled={!ok || pending}
            onClick={() => onSubmit(text.trim())}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}{" "}
            {asksInfo
              ? "Envoyer la demande"
              : definitive
                ? "Refuser définitivement"
                : "Recommander le refus"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
