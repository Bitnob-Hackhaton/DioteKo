/**
 * Pure helpers for the Increment 4 Bitnob money surface (on-chain
 * withdrawals + bulk transfers). No I/O, no DI — mirrors `payouts.util.ts`.
 *
 * Error summarisation is deliberately NOT re-implemented here: Increment 4
 * catch blocks import `summarizePayoutError` from `payouts.util.ts` (it is
 * already the shared PII-safe Bitnob error summariser — see MUST-FIX 9 in the
 * Increment 4 plan, which explicitly permits importing it rather than
 * renaming/moving it).
 */

/** Minimal logger surface so the pure helpers can warn without a DI dependency. */
export interface WithdrawalStatusLogger {
  warn(message: string): void;
}

/**
 * Local `bitnob_withdrawals.status` vocabulary.
 *
 *   pending  -> submitted -> completed | failed
 *
 * `pending`   — row inserted, Bitnob not yet called.
 * `submitted` — Bitnob accepted the request; remote status is `pending`.
 * `completed` — the on-chain transfer settled.
 * `failed`    — Bitnob rejected the request, or the transfer failed on-chain.
 *
 * There is NO local CAS-transient state (contrast `bitnob_payouts.finalizing`):
 * a withdrawal is single-shot — the row is created and the Bitnob call is made
 * inside one request, with no separate "finalize later" step, so there is no
 * window for two requests to race on the same row. Idempotency is the unique
 * `reference` (`dkwd_<id>`) + Bitnob's own same-`reference` -> 409 dedup.
 */
export const WITHDRAWAL_TERMINAL_STATUSES = ['completed', 'failed'] as const;

export function isTerminalWithdrawalStatus(status: string): boolean {
  return (WITHDRAWAL_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Forward-only progression rank for `bitnob_withdrawals.status`, mirroring
 * `payoutStatusRank`. Used by the `transfer.*` webhook dispatch to reject
 * out-of-order / backward transitions. Both terminal states share the top
 * rank (a webhook must not flip `completed` <-> `failed` — that is a
 * reconcile-required alarm, see `dispatchTransferEvent`). `-1` = unknown.
 */
export const WITHDRAWAL_STATUS_RANK: Record<string, number> = {
  pending: 0,
  submitted: 1,
  completed: 2,
  failed: 2,
};

export function withdrawalStatusRank(status: string): number {
  return status in WITHDRAWAL_STATUS_RANK ? WITHDRAWAL_STATUS_RANK[status] : -1;
}

/**
 * Map Bitnob's `data.status` (`pending` | `completed` | `failed`, lowercase
 * per the integration-analyst contract) on the `POST /api/withdrawals`
 * response to our local status. `pending` becomes `submitted` (our `pending`
 * means "not sent yet"). An UNRECOGNIZED value maps to `submitted`, NOT
 * `failed`: the request was accepted (we got a 2xx), we just can't classify
 * the lifecycle stage yet — a reconcile poll will resolve it. A warn is
 * logged so a genuinely-new value gets noticed.
 */
export function mapWithdrawalCreateStatus(remote: unknown, logger?: WithdrawalStatusLogger): string {
  const key = String(remote ?? '').trim().toLowerCase();
  switch (key) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'pending':
    case '':
      return 'submitted';
    default:
      logger?.warn(
        `[RESULT] unrecognized Bitnob withdrawal status ${JSON.stringify(String(remote ?? ''))} — treating as 'submitted'`,
      );
      return 'submitted';
  }
}

/**
 * Bitnob transaction `state` (`PENDING` | `IN_PROGRESS` | `SETTLED` |
 * `FAILED` | `REVERSED`) -> local withdrawal status, used by the reconcile
 * poll against `GET /api/transactions`. An unknown state returns `null` — the
 * caller must then NOT write (ambiguous remote state must never overwrite the
 * local ledger).
 */
export function mapTransactionStateToWithdrawalStatus(state: unknown): string | null {
  switch (String(state ?? '').trim().toUpperCase()) {
    case 'SETTLED':
      return 'completed';
    case 'FAILED':
    case 'REVERSED':
      return 'failed';
    case 'PENDING':
    case 'IN_PROGRESS':
      return 'submitted';
    default:
      return null;
  }
}

/**
 * Guard: does a Bitnob transaction `type` look like an outbound on-chain
 * withdrawal / transfer? `type` is an open string per the Increment 2
 * contract, so this matches loosely. On no match the reconcile path warns and
 * does NOT write — we will not sync a withdrawal row from a transaction we
 * can't positively identify as that withdrawal.
 */
export function looksLikeWithdrawalTransaction(type: unknown): boolean {
  return /with[dr]|transfer|payout|onchain|on_chain|crypto|send/i.test(String(type ?? ''));
}

/**
 * Local `bitnob_bulk_batches.status` vocabulary.
 *
 *   draft -> confirming -> processing -> completed | failed
 *                       \-> confirm_uncertain  (see below)
 *   draft -> cancelled
 *
 * `draft`             — batch + items persisted, `POST /api/bulk-transfers`
 *                        accepted, nothing disbursed.
 * `confirming`        — LOCAL-ONLY transient. Set by an atomic
 *                        `draft -> confirming` compare-and-swap immediately
 *                        before `POST /api/bulk-transfers/:id/confirm`, so two
 *                        concurrent confirms can't both fire the disbursement.
 * `confirm_uncertain` — LOCAL-ONLY. The confirm call threw AFTER the CAS
 *                        (network error / lost response / non-HTTP failure).
 *                        The batch is NOT reverted to `draft` — `confirm` has
 *                        no idempotency key, so a revert+retry after a lost
 *                        response would double-disburse. Operator must call
 *                        `POST /api/bitnob/bulk-transfers/:id/reconcile` to
 *                        learn the true remote state.
 * `processing`/`completed`/`failed`/`cancelled` — mirror Bitnob's batch
 *                        `status` (lowercased).
 *
 * Contrast payout `finalize`, which DOES safely revert `finalizing ->
 * initiated` on failure: that path re-reads the remote status and only
 * disburses when it is exactly `INITIATED`, so a revert is safe. Bulk
 * `confirm` has no such pre-check and no idempotency key — it does NOT revert.
 */
export const BULK_BATCH_LOCAL_TRANSIENT_STATUSES = ['confirming', 'confirm_uncertain'] as const;
export const BULK_BATCH_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export function isTerminalBulkBatchStatus(status: string): boolean {
  return (BULK_BATCH_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** Bitnob batch `status` -> local (lowercased pass-through of the known set). */
export function mapBulkBatchStatus(remote: unknown, logger?: WithdrawalStatusLogger): string {
  const key = String(remote ?? '').trim().toLowerCase();
  if (['draft', 'pending', 'processing', 'completed', 'failed', 'cancelled'].includes(key)) {
    return key === 'pending' ? 'processing' : key;
  }
  logger?.warn(
    `[RESULT] unrecognized Bitnob bulk batch status ${JSON.stringify(String(remote ?? ''))} — leaving local status unchanged`,
  );
  return '';
}

/**
 * Sum a list of base-unit integer-string amounts with BigInt (never Number —
 * float rounding on money is unacceptable). Throws on any unparseable entry so
 * the caller fails closed rather than silently under-counting a batch total.
 */
export function sumBaseUnitAmounts(amounts: readonly string[]): bigint {
  let total = 0n;
  for (const a of amounts) {
    let v: bigint;
    try {
      v = BigInt(a);
    } catch {
      throw new Error(`non-integer amount in batch: ${JSON.stringify(String(a))}`);
    }
    if (v <= 0n) {
      throw new Error(`non-positive amount in batch: ${JSON.stringify(String(a))}`);
    }
    total += v;
  }
  return total;
}

/**
 * Shallow, start-anchored PII strip for a Bitnob withdrawal / bulk raw body
 * before it lands in a `*.raw_result` jsonb column or a list response.
 *
 * A bare destination address is not PII, but a `memo` can echo free text, and
 * `sender` / `sub_account` / `beneficiary` / `account*` fields could carry
 * account identifiers. Same design rationale as `stripPayoutPii`: scoped to
 * the known response shape, shallow on purpose.
 *
 * TODO (before bulk transfers go live): a bulk `GET /api/bulk-transfers/:id`
 * body nests per-item objects under `items[]`, each of which can carry its own
 * `memo`/`description`. This shallow start-anchored pass does NOT reach into
 * that array. Add a recursive/`items[]`-aware pass here before the bulk
 * feature is enabled (it is 403 on the sandbox and prod-gated today, so the
 * gap is inert for now).
 */
export function stripWithdrawalResultPii<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (/^(memo|sender|sub_account|beneficiary|account|iban|bank_account)/i.test(key)) {
      continue;
    }
    out[key as keyof T] = value as T[keyof T];
  }
  return out;
}

/** Coerce Bitnob's empty-string "null" convention on a bulk record to real null. */
export function emptyToNull<T>(value: T): T | null {
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

/**
 * Sanitize a Bitnob webhook `event` name before it is interpolated into a log
 * line: strip CR/LF (a forged / replayed delivery can put anything in the
 * `event` field — an un-stripped newline forges fake log records) and cap the
 * length. Storage (`bitnob_webhook_events.event_type`) and dispatch logic use
 * the raw value; only logging goes through this.
 */
export function sanitizeEventName(name: unknown): string {
  return String(name ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 64);
}
