import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtPayload } from '../../../common/interfaces/jwt-payload.interface';
import {
  AccessLogAction,
  AccessLogActorType,
  AccessLogResult,
} from '../../consent/entities/access-log.entity';
import { AccessLogService } from '../../consent/services/access-log.service';
import { RoleCode } from '../../../modules/identity/entities/role.entity';
import { ConfirmBulkTransferDto } from '../dto/confirm-bulk-transfer.dto';
import { CreateBulkTransferDto } from '../dto/create-bulk-transfer.dto';
import { CreatePayoutQuoteDto } from '../dto/create-payout-quote.dto';
import { CreateWithdrawalDto } from '../dto/create-withdrawal.dto';
import { InitializePayoutDto } from '../dto/initialize-payout.dto';
import { ListBulkTransfersQueryDto } from '../dto/list-bulk-transfers-query.dto';
import { ListPayoutsQueryDto } from '../dto/list-payouts-query.dto';
import { PayoutAccountLookupQueryDto } from '../dto/payout-account-lookup-query.dto';
import { RetryBulkItemsDto } from '../dto/retry-bulk-items.dto';
import { ValidateAddressDto } from '../dto/validate-address.dto';
import { BitnobBulkBatch } from '../entities/bitnob-bulk-batch.entity';
import { BitnobBulkBatchItem } from '../entities/bitnob-bulk-batch-item.entity';
import { BitnobPayout } from '../entities/bitnob-payout.entity';
import { BitnobWithdrawal } from '../entities/bitnob-withdrawal.entity';
import { isTerminalPayoutStatus, reconcilePayoutStatus, stripPayoutPii, summarizePayoutError } from '../payouts.util';
import { isTerminalWithdrawalStatus } from '../withdrawals.util';
import { BitnobApiError } from '../services/bitnob-http-client.service';
import { BitnobBulkTransfersService } from '../services/bitnob-bulk-transfers.service';
import { BitnobPayoutsService } from '../services/bitnob-payouts.service';
import { BitnobWithdrawalsService } from '../services/bitnob-withdrawals.service';

/**
 * `/api/bitnob/payouts` — the RAW money-moving Bitnob surface. `admin` only:
 * `JwtPayload` carries no `organizationId`, so there is no safe way to scope
 * this to an issuer's organisation. The certificate-scoped payout path
 * (`/api/admin-certificates/:id/bitnob/payouts...`, issuer + admin) is the
 * route issuers use.
 *
 * `POST payouts/quotes` persists a `bitnob_payouts` row FIRST (status
 * `quote`, no `adminCertificateRefId`, no `organizationId`), derives
 * `reference = dkpayout_<row id>`, then quotes. `POST payouts/:id/initialize`
 * and `POST payouts/:id/finalize` take that row id and read `quoteId` /
 * `reference` from the row — never from the body. `initialize` + `finalize`
 * write an `access_logs` row (acting admin's user id) since they move money.
 *
 * `finalize` uses the same atomic `initiated -> finalizing` compare-and-swap
 * as the certificate path, so two concurrent requests can't both disburse.
 *
 * Read routes return a PII-free projection: `GET payouts/:id` from the local
 * row, `GET payouts` proxied to Bitnob with beneficiary data stripped from
 * every item.
 *
 * Increment 4 adds the raw on-chain WITHDRAWAL + BULK-TRANSFER surface (also
 * `admin`-only). Both are HARD-DISABLED in `production` this increment — the
 * gate lives in `BitnobWithdrawalsService.createWithdrawal` /
 * `BitnobBulkTransfersService.confirmBatch` (etc.), not just here.
 * `POST withdrawals` persists a `bitnob_withdrawals` row FIRST (status
 * `pending`, `reference = dkwd_<id>`), then calls Bitnob. There is NO
 * `GET /api/withdrawals` at Bitnob — `GET withdrawals/:id` reads the local
 * row and `POST withdrawals/:id/reconcile` polls `GET /api/transactions`.
 * Bulk: `POST bulk-transfers` drafts a batch; `POST bulk-transfers/:id/confirm`
 * is the irreversible disbursement, guarded by an `{expectedTotal,
 * expectedItemCount}` review gate + an atomic `draft -> confirming` CAS; a
 * failed confirm leaves the batch `confirm_uncertain` and requires
 * `POST bulk-transfers/:id/reconcile`.
 *
 * Every money-move ATTEMPT (withdrawal create, bulk confirm, bulk retry)
 * writes an `access_logs` row with the acting admin's user id.
 */
@ApiTags('bitnob')
@ApiBearerAuth()
@Controller('bitnob')
@Roles(RoleCode.ADMIN)
export class BitnobMoneyController {
  private readonly logger = new Logger(BitnobMoneyController.name);

  constructor(
    private readonly payoutsService: BitnobPayoutsService,
    private readonly accessLogService: AccessLogService,
    @InjectRepository(BitnobPayout)
    private readonly payoutsRepository: Repository<BitnobPayout>,
    private readonly withdrawalsService: BitnobWithdrawalsService,
    private readonly bulkTransfersService: BitnobBulkTransfersService,
    @InjectRepository(BitnobWithdrawal)
    private readonly withdrawalsRepository: Repository<BitnobWithdrawal>,
  ) {}

  @Post('payouts/quotes')
  async createQuote(@Body() dto: CreatePayoutQuoteDto) {
    const row = await this.payoutsRepository.save(
      this.payoutsRepository.create({
        status: 'quote',
        fromAsset: dto.fromAsset,
        toCurrency: dto.toCurrency,
        country: dto.country,
        source: 'offchain',
        settlementAmount: dto.settlementAmount,
      }),
    );
    const reference = `dkpayout_${row.id}`;
    this.logger.log(`[START] money.createQuote payoutId=${row.id} reference=${reference}`);

    try {
      const quote = await this.payoutsService.createQuote({
        fromAsset: dto.fromAsset,
        toCurrency: dto.toCurrency,
        country: dto.country,
        settlementAmount: dto.settlementAmount,
        reference,
        source: 'offchain',
      });
      row.reference = reference;
      row.quoteId = quote.quote_id ?? null;
      row.amount = quote.amount != null ? String(quote.amount) : null;
      row.bitnobPayoutId = quote.id ?? null;
      // The Bitnob quote response is PII-free by contract (no `beneficiary`
      // before initialize) — stored verbatim.
      row.rawQuote = quote as unknown as Record<string, unknown>;
      await this.payoutsRepository.save(row);
      this.logger.log(
        `[RESULT] money.createQuote payoutId=${row.id} reference=${reference} quoteId=${row.quoteId ?? 'n/a'} status=${row.status}`,
      );
      return { success: true, payout: this.project(row) };
    } catch (err) {
      // Quote step failed → mark `failed` so the row doesn't linger as an
      // un-actionable `quote` (nothing can advance a quote-less row).
      row.status = 'failed';
      row.rawResult = { error: summarizePayoutError(err) };
      await this.payoutsRepository.save(row).catch(() => undefined);
      this.logger.error(
        `[RESULT] money.createQuote failed payoutId=${row.id} reference=${reference} detail=${summarizePayoutError(err)}`,
      );
      throw err;
    }
  }

  @Post('payouts/:id/initialize')
  async initialize(
    @Param('id') id: string,
    @Body() dto: InitializePayoutDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const row = await this.loadRow(id);
    if (row.status !== 'quote') {
      throw new ConflictException(`Payout must be in "quote" state to initialize (current: "${row.status}")`);
    }
    if (!row.quoteId || !row.reference) {
      throw new ConflictException('Payout row is missing its quote identifiers — re-create the quote');
    }
    this.logger.log(`[START] money.initialize payoutId=${row.id} reference=${row.reference}`);

    try {
      const initialized = await this.payoutsService.initializePayout(row.quoteId, {
        reference: row.reference,
        paymentReason: dto.paymentReason,
        beneficiary: {
          destinationType: dto.beneficiary.destinationType,
          country: dto.beneficiary.country,
          accountName: dto.beneficiary.accountName,
          accountNumber: dto.beneficiary.accountNumber,
          bankCode: dto.beneficiary.bankCode,
        },
      });
      row.status = 'initiated';
      row.bitnobPayoutId = initialized.id ?? row.bitnobPayoutId;
      row.rawResult = stripPayoutPii(initialized as unknown as Record<string, unknown>);
      await this.payoutsRepository.save(row);
      await this.audit(row, user.sub, AccessLogResult.VALID);
      this.logger.log(
        `[RESULT] money.initialize payoutId=${row.id} reference=${row.reference} bitnobPayoutId=${row.bitnobPayoutId ?? 'n/a'} status=${row.status}`,
      );
      return { success: true, payout: this.project(row) };
    } catch (err) {
      row.rawResult = { error: summarizePayoutError(err) };
      await this.payoutsRepository.save(row).catch(() => undefined);
      this.logger.error(
        `[RESULT] money.initialize failed payoutId=${row.id} reference=${row.reference} detail=${summarizePayoutError(err)}`,
      );
      throw err;
    }
  }

  @Post('payouts/:id/finalize')
  async finalize(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const row = await this.loadRow(id);
    if (!row.bitnobPayoutId || !row.quoteId) {
      throw new ConflictException('Payout row is missing Bitnob identifiers — cannot finalize');
    }

    // N1 — atomic `initiated -> finalizing`. Only the winner disburses.
    const claimed = await this.payoutsRepository.update(
      { id: row.id, status: 'initiated' },
      { status: 'finalizing' },
    );
    if (claimed.affected !== 1) {
      throw new ConflictException(`Payout is not in a finalizable state (current: "${row.status}")`);
    }
    row.status = 'finalizing';
    this.logger.log(`[START] money.finalize payoutId=${row.id} reference=${row.reference ?? 'n/a'}`);

    // try/catch wraps ONLY the money-critical span (remote read + disburse +
    // status save); a failure there means nothing moved, so revert to
    // `initiated`. The audit write below is secondary and best-effort.
    try {
      const remote = await this.getPayoutOrThrow(row);
      if (String(remote?.status ?? '').toUpperCase() === 'INITIATED') {
        const finalized = await this.payoutsService.finalizePayout(row.quoteId);
        row.status = 'processing';
        row.rawResult = stripPayoutPii(finalized as unknown as Record<string, unknown>);
      } else {
        row.status = reconcilePayoutStatus(remote, this.logger);
        row.rawResult = stripPayoutPii(remote as unknown as Record<string, unknown>);
      }
      await this.payoutsRepository.save(row);
    } catch (err) {
      row.status = 'initiated';
      row.rawResult = { error: summarizePayoutError(err) };
      await this.payoutsRepository.save(row).catch(() => undefined);
      this.logger.error(
        `[RESULT] money.finalize failed payoutId=${row.id} status=initiated detail=${summarizePayoutError(err)}`,
      );
      if (err instanceof HttpException) {
        throw err;
      }
      if (err instanceof BitnobApiError) {
        throw new BadGatewayException('Bitnob rejected the payout finalize — the payout was left initiated');
      }
      throw err;
    }

    await this.audit(
      row,
      user.sub,
      isTerminalPayoutStatus(row.status) && row.status !== 'completed'
        ? AccessLogResult.ERROR
        : AccessLogResult.VALID,
    );
    this.logger.log(`[RESULT] money.finalize payoutId=${row.id} status=${row.status}`);
    return { success: true, payout: this.project(row) };
  }

  @Get('payouts/account-lookup')
  async accountLookup(@Query() query: PayoutAccountLookupQueryDto) {
    const account = await this.payoutsService.accountLookup({
      country: query.country,
      bankCode: query.bankCode,
      accountNumber: query.accountNumber,
      type: query.type,
    });
    return { success: true, account };
  }

  @Get('payouts')
  async list(@Query() query: ListPayoutsQueryDto) {
    const data = await this.payoutsService.listPayouts({
      limit: query.limit,
      offset: query.offset,
      status: query.status,
    });
    const items = Array.isArray(data?.items)
      ? data.items.map((item) => stripPayoutPii(item as unknown as Record<string, unknown>))
      : [];
    return {
      success: true,
      payouts: {
        items,
        total_count: data?.total_count ?? 0,
        limit: data?.limit,
        offset: data?.offset,
        has_more: data?.has_more ?? false,
      },
    };
  }

  @Get('payouts/:id')
  async getOne(@Param('id') id: string) {
    const row = await this.loadRow(id);
    return { success: true, payout: this.project(row) };
  }

  // === Increment 4 — on-chain withdrawals ==================================
  // Static segments before `:id`.

  /** `POST bitnob/withdrawals/validate-address` — read-only proxy, non-money. */
  @Post('withdrawals/validate-address')
  async validateWithdrawalAddress(@Body() dto: ValidateAddressDto) {
    const validation = await this.withdrawalsService.validateAddress(dto.address, dto.chain);
    return { success: true, validation };
  }

  /**
   * `POST bitnob/withdrawals` — persist a `pending` row FIRST, derive
   * `reference = dkwd_<id>`, then call Bitnob. On failure the row is marked
   * `failed` and its `reference` stays null (inert). Maps a raw Bitnob
   * rejection: 409 (duplicate reference) -> 409, anything else -> 502.
   */
  @Post('withdrawals')
  async createWithdrawal(@Body() dto: CreateWithdrawalDto, @CurrentUser() user: JwtPayload) {
    const row = await this.withdrawalsRepository.save(
      this.withdrawalsRepository.create({
        status: 'pending',
        toAddress: dto.toAddress,
        chain: dto.chain,
        currency: dto.currency,
        amount: dto.amount,
        description: dto.description ?? null,
      }),
    );
    const reference = `dkwd_${row.id}`;
    this.logger.log(`[START] money.createWithdrawal withdrawalId=${row.id} reference=${reference}`);

    try {
      const result = await this.withdrawalsService.createWithdrawal({
        toAddress: dto.toAddress,
        amount: dto.amount,
        currency: dto.currency,
        chain: dto.chain,
        reference,
        description: dto.description,
      });
      row.reference = reference;
      row.transactionId = result.transactionId;
      row.status = result.status;
      // S1 — persist the real (scrubbed) Bitnob body, not a synthesized stub:
      // keeps the on-chain tx hash + network fee.
      row.rawResult = result.raw;
      await this.withdrawalsRepository.save(row);
      await this.auditWithdrawal(
        row,
        user.sub,
        row.status === 'failed' ? AccessLogResult.ERROR : AccessLogResult.VALID,
      );
      this.logger.log(
        `[RESULT] money.createWithdrawal withdrawalId=${row.id} reference=${reference} ` +
          `transactionId=${row.transactionId ?? 'n/a'} status=${row.status}`,
      );
      return { success: true, withdrawal: this.projectWithdrawal(row) };
    } catch (err) {
      const summary = summarizePayoutError(err);

      // DEFINITE "nothing moved": our own validation / gate (HttpException), or
      // a Bitnob response with a real HTTP status code. Row is inert `failed`,
      // `reference` stays null so a client retry mints a fresh (clean) row.
      const definiteRejection =
        err instanceof HttpException || (err instanceof BitnobApiError && err.status !== null);

      if (definiteRejection) {
        row.status = 'failed';
        row.rawResult = { error: summary };
        await this.withdrawalsRepository.save(row).catch(() => undefined);
        await this.auditWithdrawal(row, user.sub, AccessLogResult.ERROR);
        this.logger.error(
          `[RESULT] money.createWithdrawal failed (definite) withdrawalId=${row.id} reference=${reference} ` +
            `detail=${summary}`,
        );
        if (err instanceof HttpException) {
          throw err;
        }
        if ((err as BitnobApiError).status === 409) {
          throw new ConflictException('A withdrawal with this reference already exists at Bitnob');
        }
        throw new BadGatewayException('Bitnob rejected the withdrawal request');
      }

      // INDETERMINATE: network-level failure (`BitnobApiError.status === null`)
      // or any other non-HTTP error — Bitnob MAY have created the withdrawal.
      // We must NOT drop the reference: a client retry would mint a fresh
      // `dkwd_<newid>` that Bitnob won't dedup -> double send. Park the row at
      // a non-terminal `submitted` with its reference persisted so `reconcile`
      // can resolve it. (Mirrors payout-finalize / bulk `confirm_uncertain`.)
      row.reference = reference;
      row.status = 'submitted';
      row.rawResult = { error: summary, indeterminate: true };
      await this.withdrawalsRepository.save(row).catch(() => undefined);
      await this.auditWithdrawal(row, user.sub, AccessLogResult.ERROR);
      this.logger.error(
        `[RESULT] money.createWithdrawal INDETERMINATE withdrawalId=${row.id} reference=${reference} ` +
          `status=submitted — reconcile before any retry detail=${summary}`,
      );
      throw new BadGatewayException(
        'Bitnob withdrawal state is indeterminate — the record is marked "submitted"; reconcile it before creating another withdrawal',
      );
    }
  }

  /** `GET bitnob/withdrawals/:id` — local row projection (no `rawResult`). */
  @Get('withdrawals/:id')
  async getWithdrawal(@Param('id') id: string) {
    const row = await this.loadWithdrawal(id);
    return { success: true, withdrawal: this.projectWithdrawal(row) };
  }

  /**
   * `POST bitnob/withdrawals/:id/reconcile` — poll `GET /api/transactions`
   * for this withdrawal's `reference` and sync the local status. A
   * no-match / ambiguous result writes nothing.
   */
  @Post('withdrawals/:id/reconcile')
  async reconcileWithdrawal(@Param('id') id: string) {
    const row = await this.loadWithdrawal(id);
    if (isTerminalWithdrawalStatus(row.status)) {
      return { success: true, withdrawal: this.projectWithdrawal(row), reconciled: false };
    }
    if (!row.reference) {
      throw new ConflictException('Withdrawal has no reference yet — nothing to reconcile');
    }
    const result = await this.withdrawalsService.reconcileWithdrawal(row.reference);
    if (result.matched) {
      row.status = result.status;
      await this.withdrawalsRepository.save(row);
    }
    return {
      success: true,
      withdrawal: this.projectWithdrawal(row),
      reconciled: result.matched,
      detail: result.detail,
    };
  }

  // === Increment 4 — bulk transfers =======================================

  /**
   * `POST bitnob/bulk-transfers` — draft a batch (nothing disbursed).
   * Intra-batch duplicate-address rejection + amount limits live in
   * `BitnobBulkTransfersService.createDraft` (exported service, self-guards).
   */
  @Post('bulk-transfers')
  async createBulkTransfer(@Body() dto: CreateBulkTransferDto, @CurrentUser() user: JwtPayload) {
    this.logger.log(
      `[START] money.createBulkTransfer items=${dto.items.length} idempotencyKey=${dto.idempotencyKey ? 'yes' : 'no'}`,
    );
    const { batch, items } = await this.bulkTransfersService.createDraft({
      description: dto.description,
      idempotencyKey: dto.idempotencyKey,
      items: dto.items.map((i) => ({
        rowIndex: i.rowIndex,
        chain: i.chain,
        currency: i.currency,
        address: i.address,
        amount: i.amount,
        description: i.description,
      })),
    });
    await this.auditBulk(batch, user.sub, AccessLogResult.VALID, 'draft');
    return {
      success: true,
      batch: this.projectBatch(batch),
      items: items.map((it) => this.projectBatchItem(it)),
    };
  }

  /** `GET bitnob/bulk-transfers` — proxied list, PII-scrubbed, cursor `next_page_token`. */
  @Get('bulk-transfers')
  async listBulkTransfers(@Query() query: ListBulkTransfersQueryDto) {
    const { batches, nextPageToken } = await this.bulkTransfersService.listBatches({
      pageToken: query.pageToken,
      limit: query.limit,
      status: query.status,
    });
    return { success: true, batches, next_page_token: nextPageToken };
  }

  /** `GET bitnob/bulk-transfers/:id` — local batch + items projection (no `rawResult`). */
  @Get('bulk-transfers/:id')
  async getBulkTransfer(@Param('id') id: string) {
    const { batch, items } = await this.loadBatchWithItems(id);
    return {
      success: true,
      batch: this.projectBatch(batch),
      items: items.map((it) => this.projectBatchItem(it)),
    };
  }

  /**
   * `POST bitnob/bulk-transfers/:id/confirm` — IRREVERSIBLE disbursement.
   * `{expectedTotal, expectedItemCount}` are re-checked against the persisted
   * items before anything happens (409 on mismatch). Blocked in production.
   */
  @Post('bulk-transfers/:id/confirm')
  async confirmBulkTransfer(
    @Param('id') id: string,
    @Body() dto: ConfirmBulkTransferDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!isUUID(id)) {
      throw new NotFoundException('Bitnob bulk batch not found');
    }
    try {
      const { batch } = await this.bulkTransfersService.confirmBatch(id, {
        expectedTotal: dto.expectedTotal,
        expectedItemCount: dto.expectedItemCount,
      });
      await this.auditBulk(batch, user.sub, AccessLogResult.VALID, 'confirm');
      return { success: true, batch: this.projectBatch(batch) };
    } catch (err) {
      await this.auditBulkById(id, user.sub, AccessLogResult.ERROR, 'confirm');
      throw err;
    }
  }

  /** `POST bitnob/bulk-transfers/:id/retry` — re-send named FAILED items. Money-moving. */
  @Post('bulk-transfers/:id/retry')
  async retryBulkTransfer(
    @Param('id') id: string,
    @Body() dto: RetryBulkItemsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!isUUID(id)) {
      throw new NotFoundException('Bitnob bulk batch not found');
    }
    try {
      const { batch, items } = await this.bulkTransfersService.retryItems(id, dto.itemIds);
      await this.auditBulk(batch, user.sub, AccessLogResult.VALID, 'retry');
      return {
        success: true,
        batch: this.projectBatch(batch),
        items: items.map((it) => this.projectBatchItem(it)),
      };
    } catch (err) {
      await this.auditBulkById(id, user.sub, AccessLogResult.ERROR, 'retry');
      throw err;
    }
  }

  /**
   * `POST bitnob/bulk-transfers/:id/reconcile` — re-read the remote batch and
   * sync the local batch + items. The only way a `confirm_uncertain` batch is
   * resolved.
   */
  @Post('bulk-transfers/:id/reconcile')
  async reconcileBulkTransfer(@Param('id') id: string) {
    if (!isUUID(id)) {
      throw new NotFoundException('Bitnob bulk batch not found');
    }
    const { batch, items } = await this.bulkTransfersService.reconcileBatch(id);
    return {
      success: true,
      batch: this.projectBatch(batch),
      items: items.map((it) => this.projectBatchItem(it)),
    };
  }

  private async loadRow(id: string): Promise<BitnobPayout> {
    if (!isUUID(id)) {
      throw new NotFoundException('Bitnob payout not found');
    }
    const row = await this.payoutsRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Bitnob payout not found');
    }
    return row;
  }

  /** N11 — a transient Bitnob read failure must not 500 the finalize request. */
  private async getPayoutOrThrow(row: BitnobPayout) {
    try {
      return await this.payoutsService.getPayout(row.bitnobPayoutId as string);
    } catch (err) {
      row.rawResult = { error: summarizePayoutError(err) };
      await this.payoutsRepository.save(row).catch(() => undefined);
      throw new ServiceUnavailableException('Could not read the payout status from Bitnob — retry shortly');
    }
  }

  /** N10 — best-effort audit for the money-moving raw routes. */
  private async audit(row: BitnobPayout, userId: string, result: AccessLogResult): Promise<void> {
    try {
      await this.accessLogService.record({
        actorType: AccessLogActorType.SYSTEM,
        actorUserId: userId,
        resourceType: 'bitnob_payout',
        resourceId: row.id,
        action: AccessLogAction.PAYOUT,
        result,
        metadata: { reference: row.reference },
      });
    } catch (err) {
      this.logger.warn(
        `[RESULT] money payout audit-log write failed payoutId=${row.id} detail=${err instanceof Error ? err.name : String(err)}`,
      );
    }
  }

  /** PII-free projection — no `beneficiary`, no `rawResult`, no `rawQuote`. */
  private project(row: BitnobPayout) {
    return {
      id: row.id,
      status: row.status,
      reference: row.reference,
      settlementAmount: row.settlementAmount,
      toCurrency: row.toCurrency,
      country: row.country,
      bitnobPayoutId: row.bitnobPayoutId,
      quoteId: row.quoteId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // === Increment 4 helpers =================================================

  private async loadWithdrawal(id: string): Promise<BitnobWithdrawal> {
    if (!isUUID(id)) {
      throw new NotFoundException('Bitnob withdrawal not found');
    }
    const row = await this.withdrawalsRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Bitnob withdrawal not found');
    }
    return row;
  }

  private async loadBatchWithItems(
    id: string,
  ): Promise<{ batch: BitnobBulkBatch; items: BitnobBulkBatchItem[] }> {
    if (!isUUID(id)) {
      throw new NotFoundException('Bitnob bulk batch not found');
    }
    return this.bulkTransfersService.getLocalBatchWithItems(id);
  }

  /** Best-effort audit for a money-moving withdrawal attempt. */
  private async auditWithdrawal(
    row: BitnobWithdrawal,
    userId: string,
    result: AccessLogResult,
  ): Promise<void> {
    try {
      await this.accessLogService.record({
        actorType: AccessLogActorType.SYSTEM,
        actorUserId: userId,
        resourceType: 'bitnob_withdrawal',
        resourceId: row.id,
        action: AccessLogAction.WITHDRAWAL,
        result,
        metadata: { reference: row.reference },
      });
    } catch (err) {
      this.logger.warn(
        `[RESULT] money withdrawal audit-log write failed withdrawalId=${row.id} ` +
          `detail=${err instanceof Error ? err.name : String(err)}`,
      );
    }
  }

  /** Best-effort audit for a bulk-transfer money-move attempt. */
  private async auditBulk(
    batch: BitnobBulkBatch,
    userId: string,
    result: AccessLogResult,
    phase: 'draft' | 'confirm' | 'retry',
  ): Promise<void> {
    try {
      await this.accessLogService.record({
        actorType: AccessLogActorType.SYSTEM,
        actorUserId: userId,
        resourceType: 'bitnob_bulk_batch',
        resourceId: batch.id,
        action: AccessLogAction.BULK_TRANSFER,
        result,
        // Aligns with the payout / withdrawal `{ reference }` convention —
        // `reference` here is the caller idempotency key. `totalItems` /
        // `totalAmount` are already columns on the batch row.
        metadata: { phase, reference: batch.idempotencyKey, bitnobBatchId: batch.bitnobBatchId },
      });
    } catch (err) {
      this.logger.warn(
        `[RESULT] money bulk-transfer audit-log write failed batchId=${batch.id} ` +
          `detail=${err instanceof Error ? err.name : String(err)}`,
      );
    }
  }

  /** Audit a bulk failure when we only have the id (the service threw before returning a batch). */
  private async auditBulkById(
    batchId: string,
    userId: string,
    result: AccessLogResult,
    phase: 'draft' | 'confirm' | 'retry',
  ): Promise<void> {
    try {
      await this.accessLogService.record({
        actorType: AccessLogActorType.SYSTEM,
        actorUserId: userId,
        resourceType: 'bitnob_bulk_batch',
        resourceId: batchId,
        action: AccessLogAction.BULK_TRANSFER,
        result,
        metadata: { phase },
      });
    } catch (err) {
      this.logger.warn(
        `[RESULT] money bulk-transfer audit-log write failed batchId=${batchId} ` +
          `detail=${err instanceof Error ? err.name : String(err)}`,
      );
    }
  }

  /** PII-free projection — no `rawResult`. */
  private projectWithdrawal(row: BitnobWithdrawal) {
    return {
      id: row.id,
      status: row.status,
      reference: row.reference,
      transactionId: row.transactionId,
      toAddress: row.toAddress,
      chain: row.chain,
      currency: row.currency,
      amount: row.amount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** PII-free projection — no `rawResult`. */
  private projectBatch(batch: BitnobBulkBatch) {
    return {
      id: batch.id,
      status: batch.status,
      idempotencyKey: batch.idempotencyKey,
      bitnobBatchId: batch.bitnobBatchId,
      description: batch.description,
      totalItems: batch.totalItems,
      totalAmount: batch.totalAmount,
      successCount: batch.successCount,
      failedCount: batch.failedCount,
      submittedAt: batch.submittedAt,
      completedAt: batch.completedAt,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    };
  }

  /** PII-free projection — no `rawResult`. */
  private projectBatchItem(item: BitnobBulkBatchItem) {
    return {
      id: item.id,
      batchId: item.batchId,
      bitnobItemId: item.bitnobItemId,
      rowIndex: item.rowIndex,
      chain: item.chain,
      currency: item.currency,
      address: item.address,
      amount: item.amount,
      status: item.status,
      failureReason: item.failureReason,
      retries: item.retries,
      withdrawalId: item.withdrawalId,
    };
  }
}
