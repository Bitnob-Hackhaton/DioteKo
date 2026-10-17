import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsentModule } from '../consent/consent.module';
import { LightningModule } from '../lightning/lightning.module';
import { BitnobIdentityController } from './controllers/bitnob-identity.controller';
import { BitnobMoneyController } from './controllers/bitnob-money.controller';
import { BitnobReadController } from './controllers/bitnob-read.controller';
import { BitnobWebhooksController } from './controllers/bitnob-webhooks.controller';
import { BitnobBulkBatch } from './entities/bitnob-bulk-batch.entity';
import { BitnobBulkBatchItem } from './entities/bitnob-bulk-batch-item.entity';
import { BitnobCard } from './entities/bitnob-card.entity';
import { BitnobClient } from './entities/bitnob-client.entity';
import { BitnobPayout } from './entities/bitnob-payout.entity';
import { BitnobTrade } from './entities/bitnob-trade.entity';
import { BitnobWebhookEvent } from './entities/bitnob-webhook-event.entity';
import { BitnobWithdrawal } from './entities/bitnob-withdrawal.entity';
import { BitnobBalancesService } from './services/bitnob-balances.service';
import { BitnobBulkTransfersService } from './services/bitnob-bulk-transfers.service';
import { BitnobHttpClientService } from './services/bitnob-http-client.service';
import { BitnobIdentityService } from './services/bitnob-identity.service';
import { BitnobInvoiceReconcilerService } from './services/bitnob-invoice-reconciler.service';
import { BitnobInvoiceSettlementService } from './services/bitnob-invoice-settlement.service';
import { BitnobLightningService } from './services/bitnob-lightning.service';
import { BitnobPayoutsService } from './services/bitnob-payouts.service';
import { BitnobRatesService } from './services/bitnob-rates.service';
import { BitnobTransactionsService } from './services/bitnob-transactions.service';
import { BitnobWebhookService } from './services/bitnob-webhook.service';
import { BitnobWithdrawalsService } from './services/bitnob-withdrawals.service';

/**
 * `integrations/bitnob` — HMAC-signed Bitnob API client. Surfaces:
 *  - payout orchestration (`BitnobPayoutsService`) — 3-step quote ->
 *    initialize -> finalize. `BitnobMoneyController` (`admin`-only) exposes
 *    the raw path; `domains/admin-certificates` imports THIS module for the
 *    certificate-scoped path (issuer + admin);
 *  - on-chain withdrawals (`BitnobWithdrawalsService`) + bulk transfers
 *    (`BitnobBulkTransfersService`) — Increment 4, `admin`-only via
 *    `BitnobMoneyController`. Both HARD-DISABLED in `production`. Increment 5
 *    adds signature-verified `transfer.*` webhook handling for
 *    `bitnob_withdrawals` (forward-only; reconcile against
 *    `GET /api/transactions` stays the authority). `bitnob_withdrawals` /
 *    `bitnob_bulk_batches` / `bitnob_bulk_batch_items` back the local ledger;
 *  - read-only data — identity/whoami (`BitnobIdentityService`, `admin`),
 *    balances / FX rates / transaction history + payout reference data
 *    (`BitnobReadController`, `issuer`/`admin`/`verifier`);
 *  - Lightning pay-in: `BitnobLightningService` (create / read an invoice) and
 *    `BitnobInvoiceSettlementService` (the only place an invoice becomes paid:
 *    the invoice is READ from Bitnob first; a webhook is just a signal);
 *    `BitnobInvoiceReconcilerService` re-reads pending Bitnob invoices on a timer (env
 *    `BITNOB_INVOICE_RECONCILE_INTERVAL_MS`, default 60000, 0 = off; also off in NODE_ENV=test)
 *    through that same settlement service;
 *  - webhook ingestion (`BitnobWebhookService`).
 *
 * Controller registration order matters: `BitnobReadController` is listed
 * BEFORE `BitnobMoneyController` so its static `payouts/{supported-countries,
 * banks,limits}` routes win over `BitnobMoneyController`'s `payouts/:id`.
 *
 * No dependency on any domain module (it does import `LightningModule`, the
 * generic invoice ledger, for pay-in); `domains/admin-certificates` imports
 * THIS module (not the other way around). `BitnobPayoutsService` and the
 * read services are exported so domain modules can drive payouts / lookups.
 *
 * `bitnob_trades` / `bitnob_cards` stay registered (tables kept) even though
 * no service writes them yet — the trading/card product families were
 * removed pending verification against Bitnob's real API.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      BitnobClient,
      BitnobPayout,
      BitnobTrade,
      BitnobCard,
      BitnobWebhookEvent,
      BitnobWithdrawal,
      BitnobBulkBatch,
      BitnobBulkBatchItem,
    ]),
    // Pay-in: invoices are marked paid through `LightningInvoicesService`. The dependency runs this way only
    // (`LightningModule` must never import `BitnobModule`), so there is no cycle.
    // `AccessLogService` — `BitnobMoneyController` writes an audit row for
    // every raw money-move attempt: payout initialize / finalize, on-chain
    // withdrawal create, and bulk-transfer confirm / retry.
    ConsentModule,
    LightningModule,
  ],
  controllers: [
    BitnobReadController,
    BitnobMoneyController,
    BitnobIdentityController,
    BitnobWebhooksController,
  ],
  providers: [
    BitnobHttpClientService,
    BitnobPayoutsService,
    BitnobWebhookService,
    BitnobIdentityService,
    BitnobBalancesService,
    BitnobRatesService,
    BitnobTransactionsService,
    BitnobWithdrawalsService,
    BitnobBulkTransfersService,
    BitnobLightningService,
    BitnobInvoiceSettlementService,
    BitnobInvoiceReconcilerService,
  ],
  exports: [
    BitnobPayoutsService,
    BitnobIdentityService,
    BitnobBalancesService,
    BitnobRatesService,
    BitnobTransactionsService,
    BitnobWithdrawalsService,
    BitnobBulkTransfersService,
    BitnobLightningService,
    BitnobInvoiceSettlementService,
  ],
})
export class BitnobModule {}
