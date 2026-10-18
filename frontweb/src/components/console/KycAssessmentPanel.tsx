import { AlertTriangle, CheckCircle2, FileSearch, ShieldQuestion, XCircle } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import {
  KYC_CONFIDENCE_LABELS,
  KYC_OCR_FIELD_LABELS,
  KYC_PROVIDER_STEP_LABELS,
  kycConfidenceLevel,
  kycProviderCodeLabel,
  type KycConfidenceLevel,
} from "@/lib/kyc-labels";
import type { KycAssessment, KycAssessmentView, KycScore } from "@/lib/types";
import { cn } from "@/lib/utils";

const percent = (n: number) => `${Math.round(n * 100)} %`;

const LEVEL_BAR: Record<KycConfidenceLevel, string> = {
  high: "bg-status-valid",
  medium: "bg-status-waiting",
  low: "bg-status-danger",
};
const LEVEL_TEXT: Record<KycConfidenceLevel, string> = {
  high: "text-status-valid",
  medium: "text-status-waiting",
  low: "text-status-danger",
};

/**
 * Jauge de confiance : barre + pourcentage + mot (« Élevée / Moyenne / Faible »), donc lisible sans la couleur.
 * `role="meter"` pour les lecteurs d'écran.
 */
export function ConfidenceMeter({ value, label }: { value: number | null; label: string }) {
  if (value === null) {
    return (
      <span className="text-xs text-muted-foreground">
        <span aria-hidden>—</span>
        <span className="sr-only">{label} : non fournie par la vérification automatique</span>
      </span>
    );
  }
  const level = kycConfidenceLevel(value);
  return (
    <div className="flex items-center justify-end gap-2">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={`${percent(value)}, ${KYC_CONFIDENCE_LABELS[level].toLowerCase()}`}
        className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", LEVEL_BAR[level])}
          style={{ width: percent(value) }}
        />
      </div>
      <span className={cn("w-24 text-right text-xs font-medium tabular-nums", LEVEL_TEXT[level])}>
        {percent(value)} · {KYC_CONFIDENCE_LABELS[level]}
      </span>
    </div>
  );
}

function ScoreRow({ label, score }: { label: string; score: KycScore | null }) {
  if (!score) return null;
  const outcome =
    score.passed === true ? (
      <span className="inline-flex items-center gap-1 text-status-valid">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Réussi
      </span>
    ) : score.passed === false ? (
      <span className="inline-flex items-center gap-1 text-status-danger">
        <XCircle className="h-3.5 w-3.5" aria-hidden /> Échec
      </span>
    ) : null;
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-3 text-right font-medium">
        {score.score !== null && <span className="tabular-nums">{percent(score.score)}</span>}
        {outcome}
        {score.score === null && !outcome && score.verdict && (
          <span className="text-xs text-muted-foreground">{score.verdict}</span>
        )}
      </dd>
    </div>
  );
}

function hasScores(a: KycAssessment) {
  return !!(a.crossValidation || a.faceMatch || a.liveness || a.riskScore !== null);
}

export function Banner({
  tone,
  title,
  children,
}: {
  tone: "warning" | "neutral";
  title: string;
  children?: React.ReactNode;
}) {
  const warning = tone === "warning";
  const Icon = warning ? AlertTriangle : ShieldQuestion;
  return (
    <div
      role="note"
      className={cn(
        "flex gap-3 rounded-md border p-4 text-sm",
        warning
          ? "border-status-waiting/40 bg-status-waiting/10"
          : "border-status-neutral/30 bg-status-neutral/5",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-5 w-5 shrink-0",
          warning ? "text-status-waiting" : "text-status-neutral",
        )}
        aria-hidden
      />
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

/**
 * Ce que la vérification automatique a lu et noté, pour décider plus vite. Réservé à l'agent (donnée personnelle) ;
 * jamais affiché au titulaire. Quatre états : lectures disponibles, rien de lu, rien de conservé, pas de contrôle automatique.
 */
export function KycAssessmentPanel({ view }: { view: KycAssessmentView }) {
  if (view.state === "not_run") {
    return (
      <Banner
        tone="neutral"
        title="Vérification manuelle — aucun contrôle automatique n'a été effectué"
      >
        Ce dossier n'est pas passé par la vérification automatique : comparez le document et le
        selfie.
      </Banner>
    );
  }

  const a = view.assessment;
  const code = a?.rejectionCode ?? null;
  const noData = view.state !== "available" || !a;

  return (
    <section aria-labelledby="kyc-auto-check" className="space-y-3">
      <Banner
        tone="warning"
        title="Vérification automatique non concluante — décision manuelle requise"
      >
        {code ? (
          <>
            <p>{kycProviderCodeLabel(code)}</p>
            <p className="mt-1 text-xs">
              Code <code className="ref-mono">{code}</code>
            </p>
            {!noData && a?.rejectionDetail && (
              <p className="mt-1 text-xs">Détail du fournisseur : {a.rejectionDetail}</p>
            )}
          </>
        ) : (
          <p>Examinez le document et le selfie avant de valider ou de rejeter.</p>
        )}
      </Banner>

      <h3 id="kyc-auto-check" className="flex items-center gap-2 text-sm font-semibold">
        <FileSearch className="h-4 w-4 text-muted-foreground" aria-hidden />
        Lecture de la vérification automatique
      </h3>

      {noData ? (
        <div className="rounded-md border border-dashed p-4 text-sm" role="status">
          <p className="font-medium">La vérification automatique n'a produit aucune donnée.</p>
          <p className="mt-1 text-muted-foreground">
            {view.state === "no_data"
              ? "Le service a répondu sans pouvoir lire la pièce. "
              : "Aucune lecture n'est conservée : service indisponible, lecture expirée ou jamais effectuée. "}
            Comparez à l'œil le document et le selfie ci-dessous.
          </p>
          {a?.rejectionDetail && (
            <p className="mt-2 text-xs text-muted-foreground">
              Détail technique : {a.rejectionDetail}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {a.ocr && (
            <div className="space-y-2">
              {a.ocr.fields.length > 0 ? (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      Champs lus sur la pièce par la vérification automatique
                    </caption>
                    <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Champ
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                          Valeur lue
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Confiance
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {a.ocr.fields.map((f) => (
                        <tr key={f.key}>
                          <th
                            scope="row"
                            className="px-3 py-2 text-left font-normal text-muted-foreground"
                          >
                            {KYC_OCR_FIELD_LABELS[f.key]}
                          </th>
                          <td className="px-3 py-2 font-medium">{f.value}</td>
                          <td className="px-3 py-2">
                            <ConfidenceMeter
                              value={f.confidence}
                              label={`Confiance de lecture : ${KYC_OCR_FIELD_LABELS[f.key]}`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  Aucun champ n'a pu être lu sur la pièce.
                </p>
              )}
              {a.ocr.confidence !== null && (
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">Confiance globale de la lecture</span>
                  <ConfidenceMeter
                    value={a.ocr.confidence}
                    label="Confiance globale de la lecture"
                  />
                </div>
              )}
              {a.ocr.fields.some((f) => f.confidence === null) && a.ocr.confidence !== null && (
                <p className="text-xs text-muted-foreground">
                  « — » : le service n'a pas donné de confiance pour ce champ.
                </p>
              )}
            </div>
          )}

          {hasScores(a) && (
            <dl className="space-y-2 rounded-md border p-4 text-sm">
              <ScoreRow label="Concordance recto / verso" score={a.crossValidation} />
              <ScoreRow label="Visage du selfie / photo de la pièce" score={a.faceMatch} />
              <ScoreRow label="Preuve de vie" score={a.liveness} />
              {a.riskScore !== null && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Score de risque</dt>
                  <dd className="font-medium tabular-nums">{a.riskScore}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}

      {a && (
        <p className="text-xs text-muted-foreground">
          Lu le {formatDateTime(a.readAt)}
          {a.providerStep
            ? ` · étape : ${KYC_PROVIDER_STEP_LABELS[a.providerStep] ?? a.providerStep}`
            : ""}
          . Données personnelles : visibles ici uniquement, supprimées à la décision.
        </p>
      )}
    </section>
  );
}
