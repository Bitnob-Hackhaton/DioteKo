import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LightningProvider } from '../../lightning/entities/lightning-invoice.entity';
import { LightningInvoicesService } from '../../lightning/services/lightning-invoices.service';
import { summarizePayoutError } from '../payouts.util';
import { BitnobApiError } from './bitnob-http-client.service';
import { BitnobInvoiceSettlementService } from './bitnob-invoice-settlement.service';

export interface InvoiceReconcileSummary {
  checked: number;
  paid: number;
  closed: number;
  /** Still pending at Bitnob (or already paid locally). */
  unchanged: number;
  /** Bitnob says paid but amount/hash/id differ from what we issued: needs a human look. */
  mismatches: number;
  errors: number;
  /** True when the run was skipped because the previous one was still in progress. */
  skipped?: boolean;
}

const BATCH_LIMIT = 50;
/** Positive intervals below this are raised to it, so a typo cannot hammer Bitnob. */
const MIN_INTERVAL_MS = 5000;

const emptySummary = (): InvoiceReconcileSummary => ({
  checked: 0,
  paid: 0,
  closed: 0,
  unchanged: 0,
  mismatches: 0,
  errors: 0,
});

/**
 * Background safety net for Bitnob pay-in: periodically re-reads pending Bitnob invoices through
 * `BitnobInvoiceSettlementService.settleIfPaid` (which READS the invoice from Bitnob and applies `paid` only when
 * amount, hash and id match). It covers a lost or never-sent webhook and closes invoices Bitnob reports expired.
 * It never decides anything itself. Plain `setInterval` (no `@nestjs/schedule` dependency), `unref()`-ed so it can
 * never keep the process alive. Off in `NODE_ENV=test` or when the interval is 0; a positive interval below 5000 ms is raised to 5000 ms (warn at startup).
 *
 * Batch: 25 NEWEST + 25 OLDEST pending invoices per run (neither a stale backlog nor a flood of recent ones
 * starves the other); a full batch is warned about since invoices in between are then not checked.
 *
 * One backend instance is recommended: every instance runs its own reconciler. This is harmless because
 * `markPaid` / `markClosed` are conditional, but Bitnob reads are duplicated; set the interval to 0 on secondary
 * instances.
 */
@Injectable()
export class BitnobInvoiceReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BitnobInvoiceReconcilerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly lightningInvoices: LightningInvoicesService,
    private readonly settlement: BitnobInvoiceSettlementService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const nodeEnv = this.config.get<string>('nodeEnv', 'development');
    const configured = this.config.get<number>('bitnob.invoiceReconcileIntervalMs', 60000);

    if (nodeEnv === 'test' || !(configured > 0)) {
      this.logger.log(
        `[STATE] invoice reconciler disabled nodeEnv=${nodeEnv} intervalMs=${configured}`,
      );
      return;
    }

    let intervalMs = configured;
    if (intervalMs < MIN_INTERVAL_MS) {
      this.logger.warn(
        `[STATE] invoice reconciler interval ${intervalMs}ms is below the ${MIN_INTERVAL_MS}ms floor, raised`,
      );
      intervalMs = MIN_INTERVAL_MS;
    }

    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    this.timer.unref();
    this.logger.log(`[STATE] invoice reconciler enabled intervalMs=${intervalMs}`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('[STATE] invoice reconciler stopped');
    }
  }

  async runOnce(): Promise<InvoiceReconcileSummary> {
    if (this.running) {
      this.logger.warn('[RESULT] invoice reconciler run skipped, previous run still in progress');
      return { ...emptySummary(), skipped: true };
    }
    this.running = true;
    const startedAt = Date.now();
    const summary = emptySummary();
    try {
      const invoices = await this.lightningInvoices.listPendingByProvider(LightningProvider.BITNOB, BATCH_LIMIT);
      summary.checked = invoices.length;
      if (invoices.length > 0) {
        this.logger.log('[START] invoice reconciler run');
        this.logger.log(`[ENTITY] pending bitnob invoices=${invoices.length}`);
      }
      if (invoices.length === BATCH_LIMIT) {
        this.logger.warn(
          `[RESULT] lot plein (${BATCH_LIMIT}), factures pending non vérifiées possibles (les plus anciennes)`,
        );
      }

      for (const invoice of invoices) {
        try {
          const result = await this.settlement.settleIfPaid(invoice);
          if (result.outcome === 'paid') {
            summary.paid++;
            this.logger.log(`[RESULT] reconciler invoice paid invoiceId=${invoice.id}`);
          } else if (result.outcome === 'closed') {
            summary.closed++;
            this.logger.log(
              `[RESULT] reconciler invoice closed invoiceId=${invoice.id} remoteStatus=${result.remoteStatus ?? 'n/a'}`,
            );
          } else if (result.outcome === 'mismatch') {
            summary.mismatches++;
            this.logger.error(`[RESULT] reconciler invoice MISMATCH invoiceId=${invoice.id} — not applied`);
          } else {
            summary.unchanged++;
          }
        } catch (error) {
          summary.errors++;
          this.logger.error(`[RESULT] reconciler failed invoiceId=${invoice.id} detail=${this.describe(error)}`);
        }
      }
    } catch (error) {
      summary.errors++;
      this.logger.error(`[RESULT] reconciler could not list pending invoices detail=${this.describe(error)}`);
    } finally {
      this.running = false;
    }

    const line =
      `[STATE] invoice reconciler done checked=${summary.checked} paid=${summary.paid} closed=${summary.closed} ` +
      `unchanged=${summary.unchanged} mismatches=${summary.mismatches} errors=${summary.errors} ` +
      `durationMs=${Date.now() - startedAt}`;
    if (summary.checked === 0 && summary.errors === 0) {
      this.logger.debug(line);
    } else {
      this.logger.log(line);
    }
    return summary;
  }

  /** PII-safe error text: a BitnobApiError can echo upstream bodies, so it goes through the shared summariser. */
  private describe(error: unknown): string {
    if (error instanceof BitnobApiError) return summarizePayoutError(error);
    return error instanceof Error ? error.message : String(error);
  }
}
