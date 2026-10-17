import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BITNOB_WITHDRAWAL_CURRENCIES,
  WITHDRAWAL_MAX_BASE_UNITS,
  WITHDRAWAL_MIN_BASE_UNITS,
} from '../bitnob-chains.constants';
import { unwrapBitnob } from '../common/bitnob-envelope.util';
import {
  looksLikeWithdrawalTransaction,
  mapTransactionStateToWithdrawalStatus,
  mapWithdrawalCreateStatus,
  stripWithdrawalResultPii,
} from '../withdrawals.util';
import { BitnobHttpClientService } from './bitnob-http-client.service';
import { BitnobTransactionsService } from './bitnob-transactions.service';

export interface CreateWithdrawalInput {
  toAddress: string;
  /** base-unit integer string */
  amount: string;
  currency: string;
  /** lowercase chain slug — REQUIRED by Bitnob */
  chain: string;
  /** deterministic `dkwd_<row id>` — Bitnob's only idempotency key */
  reference: string;
  /** internal label; forwarded to Bitnob as `description`, never logged by value */
  description?: string;
}

export interface CreateWithdrawalResult {
  transactionId: string | null;
  /** local status: `submitted` | `completed` | `failed` */
  status: string;
  /**
   * The full Bitnob `POST /api/withdrawals` response body, PII-scrubbed
   * (`stripWithdrawalResultPii`) — persisted verbatim as
   * `bitnob_withdrawals.raw_result` so the on-chain tx hash + network fee are
   * not thrown away. Mirrors the payout path storing `stripPayoutPii(finalized)`.
   */
  raw: Record<string, unknown>;
}

export interface ReconcileWithdrawalResult {
  /** true only when a single, positively-identified withdrawal transaction was found */
  matched: boolean;
  /** local status when `matched`, else the unchanged input status hint */
  status: string;
  detail: string;
}

/**
 * The Bitnob on-chain withdrawal surface: a single stablecoin transfer to an
 * external address (`POST /api/withdrawals`), address validation
 * (`POST /api/addresses/validate`), and a polling reconcile against
 * `GET /api/transactions` (Bitnob exposes NO `GET /api/withdrawals`).
 *
 * Money bodies are built here as explicit snake_case objects (never the
 * caller's DTO spread through). This service has NO repository: the local
 * `bitnob_withdrawals` row is owned by `BitnobMoneyController`, which holds
 * the deterministic `reference` and the transactional writes — same split as
 * `BitnobPayoutsService`.
 *
 * `transfer.success` / `transfer.failed` webhooks ARE handled as of Increment
 * 5 (`BitnobWebhookService.dispatchTransferEvent`, signature-verified,
 * forward-only). Reconcile against `GET /api/transactions` remains the
 * authority for any money decision — the webhook is a latency optimisation.
 */
@Injectable()
export class BitnobWithdrawalsService {
  private readonly logger = new Logger(BitnobWithdrawalsService.name);

  constructor(
    private readonly http: BitnobHttpClientService,
    private readonly config: ConfigService,
    private readonly transactions: BitnobTransactionsService,
  ) {}

  private environment(): string {
    return this.config.get<string>('bitnob.environment', 'sandbox');
  }

  private str(v: unknown): string | null {
    return typeof v === 'string' && v.length > 0 ? v : null;
  }

  /**
   * `POST /api/addresses/validate`. Read-only. The response `data` shape,
   * verified by the Phase 1 probe (2026-08-30), is
   * `{ valid: boolean, address, chain, error?: string }` — the field is
   * `valid` (NOT `is_valid`), and `error` is only present when
   * `valid === false`.
   */
  async validateAddress(address: string, chain: string): Promise<{ valid: boolean; error: string | null }> {
    this.logger.log(`[START] withdrawals.validateAddress chain=${chain}`);
    const data = unwrapBitnob<{ valid?: unknown; is_valid?: unknown; error?: unknown }>(
      await this.http.post('/api/addresses/validate', { address, chain }),
    );
    const valid = data?.valid === true || data?.is_valid === true;
    const error = typeof data?.error === 'string' ? data.error : null;
    this.logger.log(`[RESULT] withdrawals.validateAddress chain=${chain} valid=${valid}`);
    return { valid, error };
  }

  /**
   * `POST /api/withdrawals`.
   *
   * MUST-FIX 1 — the production gate is the FIRST statement, in the service
   * (not just the controller). MUST-FIX 4 — a BigInt backstop behind the DTO
   * regex enforces `> 0`, the $10 base-unit minimum, the absolute ceiling,
   * and USDT/USDC-only, with no FX call.
   *
   * Bitnob validates `to_address` server-side (Phase 1 probe: a malformed
   * address -> HTTP 400 `VALIDATION_ERROR`; an under-funded wallet -> HTTP
   * 422 `INSUFFICIENT_FUNDS`). The caller maps a raw `BitnobApiError` to an
   * appropriate HTTP status (409 on duplicate `reference`, 502 otherwise) and
   * — critically — distinguishes a definite HTTP rejection (nothing moved)
   * from a network-level failure (`BitnobApiError.status === null`, where
   * Bitnob MAY have created the withdrawal): see `BitnobMoneyController`.
   *
   * KNOWN LIMITATION: the raw withdrawal path has NO content-derived
   * idempotency key. `reference` is `dkwd_<row id>`, so a client that retries
   * after an indeterminate failure gets a FRESH row -> a FRESH `dkwd_<newid>`,
   * which Bitnob will not dedup against the first attempt -> double send. A
   * content key (hash of `to_address`+`amount`+`currency`+`chain`) is a
   * prerequisite before the production gate can be lifted. Until then the
   * controller parks an indeterminate attempt at `status='submitted'` with its
   * `reference` persisted so `reconcile` can resolve it before any retry.
   */
  async createWithdrawal(input: CreateWithdrawalInput): Promise<CreateWithdrawalResult> {
    if (this.environment() === 'production') {
      throw new ForbiddenException(
        'Bitnob on-chain withdrawals are disabled in production (Increment 4 interim state)',
      );
    }

    if (!(BITNOB_WITHDRAWAL_CURRENCIES as readonly string[]).includes(input.currency)) {
      throw new BadRequestException('currency must be USDT or USDC this increment');
    }

    let amount: bigint;
    try {
      amount = BigInt(input.amount);
    } catch {
      throw new BadRequestException('amount is not a valid base-unit integer');
    }
    if (amount <= 0n) {
      throw new BadRequestException('amount must be positive');
    }
    if (amount < WITHDRAWAL_MIN_BASE_UNITS) {
      throw new BadRequestException('amount is below the $10 minimum withdrawal');
    }
    if (amount > WITHDRAWAL_MAX_BASE_UNITS) {
      throw new BadRequestException('amount exceeds the per-withdrawal ceiling');
    }

    const body: Record<string, string> = {
      to_address: input.toAddress,
      amount: input.amount,
      currency: input.currency,
      chain: input.chain,
      reference: input.reference,
    };
    if (input.description) {
      body.description = input.description;
    }

    this.logger.log(
      `[START] withdrawals.createWithdrawal reference=${input.reference} chain=${input.chain} ` +
        `currency=${input.currency} descriptionLen=${input.description?.length ?? 0} environment=${this.environment()}`,
    );
    const data = unwrapBitnob<Record<string, unknown>>(await this.http.post('/api/withdrawals', body));
    // Field name unverified — no funded sandbox to observe a success body.
    const transactionId = this.str(data?.transaction_id) ?? this.str(data?.id);
    const status = mapWithdrawalCreateStatus(data?.status, this.logger);
    const raw = stripWithdrawalResultPii((data ?? {}) as Record<string, unknown>) as Record<string, unknown>;
    this.logger.log(
      `[RESULT] withdrawals.createWithdrawal reference=${input.reference} ` +
        `transactionId=${transactionId ?? 'n/a'} status=${status}`,
    );
    return { transactionId, status, raw };
  }

  /**
   * Reconcile a withdrawal by its `reference` against `GET /api/transactions`.
   *
   * `GET /api/transactions/:id` accepts "the UUID or the custom reference
   * string" (Increment 2 finding), so we try that first; on a miss we list
   * recent transactions and filter by exact `reference`. Either way we only
   * report `matched` when the transaction's `type` positively looks like a
   * withdrawal/transfer — an ambiguous or unknown match warns and writes
   * nothing (the caller must not touch the local ledger).
   */
  async reconcileWithdrawal(reference: string): Promise<ReconcileWithdrawalResult> {
    this.logger.log(`[START] withdrawals.reconcileWithdrawal reference=${reference}`);

    let tx: { reference?: unknown; type?: unknown; state?: unknown } | null = null;
    try {
      tx = await this.transactions.getById(reference);
    } catch {
      tx = null;
    }

    let listWindowSearched = false;
    if (!tx || String(tx.reference ?? '') !== reference) {
      const list = await this.transactions.list({ limit: 100 }).catch(() => null);
      listWindowSearched = list !== null;
      const hit = list?.transactions?.find((t) => String(t.reference ?? '') === reference) ?? null;
      tx = hit;
    }

    if (!tx) {
      // NOT proof that nothing moved: `GET /api/transactions/:reference` missed
      // and the list fallback only covers the ~100 most recent transactions
      // (no pagination). An older or not-yet-indexed withdrawal would not show.
      this.logger.warn(
        `[RESULT] withdrawals.reconcileWithdrawal reference=${reference} no matching transaction ` +
          `(by-id lookup missed; recent-window list ${listWindowSearched ? 'searched (~100 txns, no pagination)' : 'unavailable'}) ` +
          `— NOT proof nothing moved`,
      );
      return { matched: false, status: 'submitted', detail: 'no matching transaction found in the recent window' };
    }
    if (!looksLikeWithdrawalTransaction(tx.type)) {
      this.logger.warn(
        `[RESULT] withdrawals.reconcileWithdrawal reference=${reference} transaction type not a withdrawal — no write`,
      );
      return { matched: false, status: 'submitted', detail: 'transaction type is not a withdrawal — not reconciled' };
    }

    const mapped = mapTransactionStateToWithdrawalStatus(tx.state);
    if (mapped === null) {
      this.logger.warn(
        `[RESULT] withdrawals.reconcileWithdrawal reference=${reference} unknown transaction state — no write`,
      );
      return { matched: false, status: 'submitted', detail: 'unknown transaction state — not reconciled' };
    }

    this.logger.log(`[RESULT] withdrawals.reconcileWithdrawal reference=${reference} status=${mapped}`);
    return { matched: true, status: mapped, detail: `reconciled from transaction state` };
  }
}
