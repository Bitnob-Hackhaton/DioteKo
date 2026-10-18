import { CheckCircle2, FileSearch, XCircle } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { kycCheckLabel } from "@/lib/kyc-labels";
import type { KycAutoAuditScore, KycAutoAuditView } from "@/lib/types";
import { Banner } from "./KycAssessmentPanel";

/** Pourcentage à une décimale (« 90,5 % »), sans « ,0 » inutile : le visage se joue au dixième près (0,905 pour 0,55). */
const pct = (n: number) => `${(n * 100).toFixed(1).replace(/\.0$/, "").replace(".", ",")} %`;

function Outcome({ passed }: { passed: boolean | null }) {
  if (passed === null) return null;
  return passed ? (
    <span className="inline-flex items-center gap-1 text-status-valid">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Réussi
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-status-danger">
      <XCircle className="h-3.5 w-3.5" aria-hidden /> Échec
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-3 text-right font-medium">{children}</dd>
    </div>
  );
}

function ScoreRow({
  label,
  score,
  withThreshold,
}: {
  label: string;
  score: KycAutoAuditScore | null;
  withThreshold?: boolean;
}) {
  if (!score) return null;
  return (
    <Row label={label}>
      {score.score !== null && <span className="tabular-nums">{pct(score.score)}</span>}
      {withThreshold && score.threshold !== null && (
        <span className="text-xs font-normal text-muted-foreground tabular-nums">
          seuil {pct(score.threshold)}
        </span>
      )}
      <Outcome passed={score.passed} />
    </Row>
  );
}

const yesNo = (v: boolean | null) => (v === null ? "Non communiqué" : v ? "Oui" : "Non");

/**
 * Trace d'un dossier que le fournisseur a validé seul : consultation en lecture seule, sans photo ni texte lu sur la pièce
 * (minimisation des données). Si le fournisseur tournait en bac à sable, un avertissement le dit : son verdict n'est pas
 * fiable pour la production.
 */
export function KycAutoAuditPanel({
  view,
  verifiedAt,
}: {
  view: KycAutoAuditView;
  verifiedAt?: string | undefined;
}) {
  const a = view.audit;
  const cross = a?.crossValidation ?? null;

  return (
    <section aria-labelledby="kyc-auto-audit" className="space-y-3">
      <Banner tone="neutral" title="Vérifié automatiquement">
        <p>
          Le fournisseur a validé ce dossier seul, sans agent
          {verifiedAt ? ` (le ${formatDateTime(verifiedAt)})` : ""}. Aucune photo ni aucun texte lu
          sur la pièce n'est conservé : seuls les scores ci-dessous le sont.
        </p>
      </Banner>

      {a?.isSandbox === true && (
        <Banner
          tone="warning"
          title="Fournisseur en mode bac à sable : résultat non fiable pour la production"
        >
          <p>
            Le fournisseur de vérification tournait en mode de test : ce verdict ne prouve pas que
            la pièce est authentique ni qu'elle appartient au titulaire.
          </p>
        </Banner>
      )}

      <h3 id="kyc-auto-audit" className="flex items-center gap-2 text-sm font-semibold">
        <FileSearch className="h-4 w-4 text-muted-foreground" aria-hidden />
        Scores de la vérification automatique
      </h3>

      {!a ? (
        <div className="rounded-md border border-dashed p-4 text-sm" role="status">
          <p className="font-medium">Aucun détail n'est conservé pour ce dossier.</p>
          <p className="mt-1 text-muted-foreground">
            Il a été validé avant la mise en place de cette trace, ou sa durée de conservation est
            dépassée, ou la clé de chiffrement est absente.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <dl className="space-y-2 rounded-md border p-4 text-sm">
            <Row label="Verdict du fournisseur">
              {a.providerVerdict === "verified"
                ? "Vérifié"
                : (a.providerVerdict ?? "Non communiqué")}
            </Row>
            <ScoreRow
              label="Visage du selfie / photo de la pièce"
              score={a.faceMatch}
              withThreshold
            />
            <ScoreRow label="Preuve de vie" score={a.liveness} withThreshold />
            {cross && (
              <Row label="Concordance recto / verso">
                {cross.score !== null && <span className="tabular-nums">{pct(cross.score)}</span>}
                {cross.verdict && (
                  <span className="text-xs font-normal text-muted-foreground">{cross.verdict}</span>
                )}
                <Outcome passed={cross.passed} />
              </Row>
            )}
            <Row label="Document expiré">{yesNo(a.documentExpired)}</Row>
            <Row label="Fournisseur en bac à sable">{yesNo(a.isSandbox)}</Row>
          </dl>

          {cross && cross.checks.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Contrôles de concordance, champ par champ (sans les valeurs lues)
                </caption>
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Champ comparé
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Score
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Résultat
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {cross.checks.map((c) => (
                    <tr key={c.name}>
                      <th
                        scope="row"
                        className="px-3 py-2 text-left font-normal text-muted-foreground"
                      >
                        {kycCheckLabel(c.name)}
                      </th>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.score !== null ? pct(c.score) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        <Outcome passed={c.passed} />
                        {c.passed === null && <span aria-hidden>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Lu le {formatDateTime(a.readAt)}. Ces scores ne contiennent aucune donnée personnelle ;
            ils sont supprimés à l'échéance de la durée de conservation.
          </p>
        </div>
      )}
    </section>
  );
}
