/**
 * Shared, pure helpers for the Bitnob payout flow. No I/O, no DI — imported
 * by `BitnobPayoutsService`, `BitnobMoneyController` and
 * `AdminCertificatesService` alike.
 */
import { BitnobApiError } from './services/bitnob-http-client.service';

/** Minimal logger surface so the pure helpers can warn without a DI dependency. */
export interface PayoutStatusLogger {
  warn(message: string): void;
}

/**
 * Bitnob payout record `status` vocabulary, verified against the live
 * sandbox (2026-08-30): `QUOTE -> INITIATED -> PENDING -> PROCESSING ->
 * COMPLETED | FAILED`, plus `EXPIRED` for a quote that lapsed before
 * initialize. We persist the lowercase form locally (matches the values the
 * webhook handler already writes: `processing` / `completed` / `expired`).
 *
 * `finalizing` is a LOCAL-ONLY transient status (never a Bitnob value): set
 * by an atomic `initiated -> finalizing` compare-and-swap immediately before
 * the disbursement call, so two concurrent finalize requests can't both
 * proceed. It resolves to `processing` (or the reconciled remote status) on
 * completion, or back to `initiated` if the Bitnob call never ran.
 */
export const PAYOUT_TERMINAL_STATUSES = ['completed', 'failed', 'expired'] as const;

/**
 * Forward-only progression rank. Used to reject out-of-order webhook
 * transitions (e.g. a late `payouts.initialized` after we already moved to
 * `processing`). All terminal states share the top rank. `-1` = unknown.
 */
export const PAYOUT_STATUS_RANK: Record<string, number> = {
  quote: 0,
  initiated: 1,
  finalizing: 2,
  pending: 3,
  processing: 4,
  completed: 5,
  failed: 5,
  expired: 5,
};

export function payoutStatusRank(status: string): number {
  return status in PAYOUT_STATUS_RANK ? PAYOUT_STATUS_RANK[status] : -1;
}

const BITNOB_STATUS_MAP: Record<string, string> = {
  QUOTE: 'quote',
  INITIATED: 'initiated',
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  EXPIRED: 'expired',
};

/**
 * Normalize a Bitnob (upper-case) payout status to our lowercase local form.
 * An UNRECOGNIZED status maps to `'failed'` (not a pass-through): money code
 * must not persist a status it can't reason about — a bad value would never
 * be terminal and would block the certificate from ever being re-paid. A
 * warn is logged so a genuinely-new Bitnob status gets noticed; `reconcile`
 * can then re-sync once the mapping is fixed.
 */
export function mapBitnobPayoutStatus(bitnobStatus: unknown, logger?: PayoutStatusLogger): string {
  const key = String(bitnobStatus ?? '').trim().toUpperCase();
  if (key in BITNOB_STATUS_MAP) {
    return BITNOB_STATUS_MAP[key];
  }
  logger?.warn(
    `[RESULT] unknown Bitnob payout status ${JSON.stringify(String(bitnobStatus ?? ''))} — treating as 'failed'`,
  );
  return 'failed';
}

/**
 * Maps a freshly-polled remote payout to our local status. Normally a
 * straight `mapBitnobPayoutStatus`, but a payout Bitnob still reports as
 * `QUOTE` after its `expires_at` is a dead quote — record it as `expired` so
 * it no longer blocks a fresh payout for that certificate (the partial
 * unique index + the 409 pre-check both exclude `expired`).
 */
export function reconcilePayoutStatus(
  remote: { status?: unknown; expires_at?: string } | null | undefined,
  logger?: PayoutStatusLogger,
): string {
  const mapped = mapBitnobPayoutStatus(remote?.status, logger);
  if (mapped === 'quote' && remote?.expires_at) {
    const expiresAt = Date.parse(remote.expires_at);
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
      return 'expired';
    }
  }
  return mapped;
}

export function isTerminalPayoutStatus(status: string): boolean {
  return (PAYOUT_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Strip beneficiary / bank-account PII from a Bitnob payout body before it
 * is persisted to `bitnob_payouts.raw_result` or returned in a list
 * response. Removes any top-level key matching
 * `/^(beneficiary|account|iban|bank_account)/i`.
 *
 * Start-anchored + shallow BY DESIGN: it is scoped to the verified Bitnob
 * payout record shape (probed live 2026-08-30), where the only PII is the
 * top-level `beneficiary` object (`account_name` / `account_number`). A deep
 * walk would risk mangling `exchange_rate` / `trip` sub-objects for no gain.
 * If Bitnob ever nests beneficiary data deeper, this must be revisited.
 */
export function stripPayoutPii<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (/^(beneficiary|account|iban|bank_account)/i.test(key)) {
      continue;
    }
    out[key as keyof T] = value as T[keyof T];
  }
  return out;
}

/**
 * PII-safe error summary for `bitnob_payouts.raw_result` and
 * `[RESULT] ... failed` log lines.
 *
 * - `BitnobApiError`: only the non-sensitive RFC 7807 discriminators
 *   (`code` / `title` / `type`) — never `detail` / `message`, which echo the
 *   beneficiary account number.
 * - Any other `Error` (e.g. an `Error(message)` thrown by `unwrapBitnob` on a
 *   200-but-`success:false` body, whose `message` may contain an account
 *   number): the class name ONLY, never `.message`.
 */
export function summarizePayoutError(err: unknown): string {
  if (err instanceof BitnobApiError) {
    const parts = [`status=${err.status ?? 'n/a'}`];
    const body = err.responseBody;
    if (body !== null && typeof body === 'object') {
      const source = body as Record<string, unknown>;
      for (const key of ['code', 'title', 'type'] as const) {
        if (typeof source[key] === 'string') {
          parts.push(`${key}=${source[key] as string}`);
        }
      }
    }
    return `BitnobApiError ${parts.join(' ')}`;
  }
  if (err instanceof Error) {
    return err.name || 'Error';
  }
  return 'non-error thrown';
}
