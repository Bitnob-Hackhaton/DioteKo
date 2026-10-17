import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  BULK_BATCH_MAX_TOTAL_BASE_UNITS,
  BITNOB_WITHDRAWAL_CURRENCIES,
  WITHDRAWAL_MAX_BASE_UNITS,
  WITHDRAWAL_MIN_BASE_UNITS,
} from '../bitnob-chains.constants';
import { unwrapBitnob } from '../common/bitnob-envelope.util';
import { BitnobBulkBatch } from '../entities/bitnob-bulk-batch.entity';
import { BitnobBulkBatchItem } from '../entities/bitnob-bulk-batch-item.entity';
import { summarizePayoutError } from '../payouts.util';
import {
  emptyToNull,
  mapBulkBatchStatus,
  stripWithdrawalResultPii,
  sumBaseUnitAmounts,
} from '../withdrawals.util';
import { BitnobApiError, BitnobHttpClientService } from './bitnob-http-client.service';

export interface BulkDraftItemInput {
  rowIndex?: number;
  chain: string;
  currency: string;
  address: string;
  /** base-unit integer string */
  amount: string;
  description?: string;
}

export interface CreateBulkDraftInput {
  description?: string;
  idempotencyKey?: string;
  items: BulkDraftItemInput[];
}

export interface ListBulkBatchesInput {
  pageToken?: string;
  limit?: number;
  status?: string;
}

type RemoteRecord = Record<string, unknown>;

/**
 * The Bitnob bulk-transfer surface: draft a batch (`POST /api/bulk-transfers`),
 * confirm it (`POST /api/bulk-transfers/:id/confirm` — the irreversible
 * disbursement of N transfers), retry failed items, and read/reconcile.
 *
 * Unlike `BitnobPayoutsService` / `BitnobWithdrawalsService`, this service
 * OWNS its persistence (`bitnob_bulk_batches` + `bitnob_bulk_batch_items`):
 * the confirm review gate has to recompute the batch total from the persisted
 * items, and the local CAS on `draft -> confirming` is central to the safety
 * model — keeping that logic in one place is clearer than splitting it with a
 * controller.
 *
 * SECURITY MODEL (MUST-FIX 1/2/3):
 *  - production gate is the first line of every money-moving method;
 *  - `confirm` recomputes `sum(amount)` + item count over the persisted items
 *    and refuses on any mismatch with the caller's `expectedTotal` /
 *    `expectedItemCount`, BEFORE the CAS and BEFORE Bitnob;
 *  - `confirm` claims the batch with an atomic `draft -> confirming` CAS;
 *  - a failed/lost `confirm` response leaves the batch at `confirm_uncertain`
 *    (NEVER reverted to `draft` — `confirm` has no idempotency key, so a
 *    revert+retry after a lost response would double-disburse). Only an
 *    explicit reconcile against `GET /api/bulk-transfers/:id` resolves it.
 *
 * NOTE: bulk-transfer WRITE paths are "Feature Not Enabled" on the DioteKo
 * sandbox account (Phase 1 probe: `POST /api/bulk-transfers` -> 403), so the
 * request/response shapes below follow the integration-analyst contract and
 * are NOT verified against a live sandbox. `GET /api/bulk-transfers` DOES
 * work and returned `{ batches: [], next_page_token }`.
 */
@Injectable()
export class BitnobBulkTransfersService {
  private readonly logger = new Logger(BitnobBulkTransfersService.name);

  constructor(
    private readonly http: BitnobHttpClientService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(BitnobBulkBatch)
    private readonly batchesRepo: Repository<BitnobBulkBatch>,
    @InjectRepository(BitnobBulkBatchItem)
    private readonly itemsRepo: Repository<BitnobBulkBatchItem>,
  ) {}

  private environment(): string {
    return this.config.get<string>('bitnob.environment', 'sandbox');
  }

  private assertProdDisabled(action: string): void {
    if (this.environment() === 'production') {
      throw new ForbiddenException(
        `Bitnob bulk transfer ${action} is disabled in production (Increment 4 interim state)`,
      );
    }
  }

  /**
   * `POST /api/bulk-transfers` — persist a DRAFT batch + its items, then
   * register the batch with Bitnob. Nothing is disbursed here.
   *
   * Idempotency: a batch already stored under the same `idempotencyKey` is
   * returned unchanged (no second Bitnob call). A concurrent same-key insert
   * that loses the unique-index race is resolved the same way.
   */
  async createDraft(
    input: CreateBulkDraftInput,
  ): Promise<{ batch: BitnobBulkBatch; items: BitnobBulkBatchItem[] }> {
    this.assertProdDisabled('draft creation');

    this.assertNoDuplicateAddresses(input.items);
    const total = this.assertItemAmounts(input.items);

    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        this.logger.log(`[RESULT] bulk.createDraft idempotent-hit batchId=${existing.batch.id}`);
        return existing;
      }
    }

    let batch: BitnobBulkBatch;
    let items: BitnobBulkBatchItem[];
    try {
      const persisted = await this.dataSource.transaction(async (m) => {
        const b = await m.save(
          m.create(BitnobBulkBatch, {
            status: 'draft',
            idempotencyKey: input.idempotencyKey ?? null,
            description: input.description ?? null,
            totalItems: input.items.length,
            totalAmount: total.toString(),
          }),
        );
        const rows = input.items.map((it, i) =>
          m.create(BitnobBulkBatchItem, {
            batchId: b.id,
            rowIndex: it.rowIndex ?? i + 1,
            chain: it.chain,
            currency: it.currency,
            address: it.address,
            amount: it.amount,
            description: it.description ?? null,
            status: 'pending',
          }),
        );
        const savedItems = await m.save(rows);
        return { batch: b, items: savedItems };
      });
      batch = persisted.batch;
      items = persisted.items;
    } catch (err) {
      if (input.idempotencyKey && this.isUniqueViolation(err)) {
        const existing = await this.findByIdempotencyKey(input.idempotencyKey);
        if (existing) {
          this.logger.log(`[RESULT] bulk.createDraft idempotent-race batchId=${existing.batch.id}`);
          return existing;
        }
      }
      throw err;
    }

    this.logger.log(
      `[START] bulk.createDraft batchId=${batch.id} items=${items.length} total=${total.toString()} ` +
        `environment=${this.environment()}`,
    );

    const effectiveKey = input.idempotencyKey ?? `dkbulk_${batch.id}`;
    const wireBody = this.compact({
      description: batch.description ?? undefined,
      idempotency_key: effectiveKey,
      items: items.map((it) =>
        this.compact({
          row_index: it.rowIndex ?? undefined,
          chain: it.chain,
          currency: it.currency,
          address: it.address,
          amount: it.amount,
          description: it.description ?? undefined,
        }),
      ),
    });

    try {
      const data = unwrapBitnob<{ batch?: RemoteRecord; items?: RemoteRecord[] }>(
        await this.http.post('/api/bulk-transfers', wireBody),
      );
      batch.bitnobBatchId = this.str(data?.batch?.id);
      const mapped = mapBulkBatchStatus(data?.batch?.status, this.logger);
      if (mapped) {
        batch.status = mapped;
      }
      batch.rawResult = stripWithdrawalResultPii((data?.batch ?? {}) as RemoteRecord);
      this.applyRemoteItemIds(items, Array.isArray(data?.items) ? data.items : []);

      await this.batchesRepo.save(batch);
      await this.itemsRepo.save(items);
      this.logger.log(
        `[RESULT] bulk.createDraft batchId=${batch.id} bitnobBatchId=${batch.bitnobBatchId ?? 'n/a'} status=${batch.status}`,
      );
      return { batch, items };
    } catch (err) {
      batch.status = 'failed';
      batch.rawResult = { error: summarizePayoutError(err) };
      await this.batchesRepo.save(batch).catch(() => undefined);
      this.logger.error(
        `[RESULT] bulk.createDraft failed batchId=${batch.id} detail=${summarizePayoutError(err)}`,
      );
      if (err instanceof HttpException) {
        throw err;
      }
      if (err instanceof BitnobApiError) {
        throw new BadGatewayException('Bitnob rejected the bulk transfer draft');
      }
      throw err;
    }
  }

  /**
   * Load a batch + its items from the LOCAL ledger (no Bitnob call). Backs
   * `GET /api/bitnob/bulk-transfers/:id`.
   */
  async getLocalBatchWithItems(
    localId: string,
  ): Promise<{ batch: BitnobBulkBatch; items: BitnobBulkBatchItem[] }> {
    const batch = await this.loadBatch(localId);
    const items = await this.itemsRepo.find({
      where: { batchId: batch.id },
      order: { rowIndex: 'ASC' },
    });
    return { batch, items };
  }

  /** `GET /api/bulk-transfers/:batchId` — remote batch + items, empty strings coerced to null. */
  async getBatch(
    bitnobBatchId: string,
  ): Promise<{ batch: RemoteRecord | null; items: RemoteRecord[] }> {
    this.logger.log(`[START] bulk.getBatch bitnobBatchId=${bitnobBatchId}`);
    const data = unwrapBitnob<{ batch?: RemoteRecord; items?: RemoteRecord[] }>(
      await this.http.get(`/api/bulk-transfers/${encodeURIComponent(bitnobBatchId)}`),
    );
    const batch = data?.batch ? this.coerceEmpty(data.batch) : null;
    const items = Array.isArray(data?.items) ? data.items.map((it) => this.coerceEmpty(it)) : [];
    this.logger.log(
      `[RESULT] bulk.getBatch bitnobBatchId=${bitnobBatchId} status=${String(batch?.status ?? 'n/a')} items=${items.length}`,
    );
    return { batch, items };
  }

  /**
   * `POST /api/bulk-transfers/:batchId/confirm` — the irreversible
   * disbursement. See the SECURITY MODEL note on the class.
   */
  async confirmBatch(
    localId: string,
    expected: { expectedTotal: string; expectedItemCount: number },
  ): Promise<{ batch: BitnobBulkBatch }> {
    this.assertProdDisabled('confirm');

    const batch = await this.loadBatch(localId);
    if (!batch.bitnobBatchId) {
      throw new ConflictException('Batch was never registered with Bitnob — cannot confirm');
    }
    if (batch.status !== 'draft') {
      throw new ConflictException(`Batch must be "draft" to confirm (current: "${batch.status}")`);
    }

    // MUST-FIX 2c — recompute over the PERSISTED items, BEFORE the CAS and
    // BEFORE Bitnob. Done before the CAS on purpose: a benign review-gate
    // mismatch must not strand the batch in the local `confirming` state.
    const items = await this.itemsRepo.find({ where: { batchId: batch.id } });
    const actualTotal = sumBaseUnitAmounts(items.map((i) => i.amount));
    const actualCount = items.length;

    let expectedTotal: bigint;
    try {
      expectedTotal = BigInt(expected.expectedTotal);
    } catch {
      throw new BadRequestException('expectedTotal is not a valid base-unit integer');
    }
    if (actualTotal !== expectedTotal || actualCount !== expected.expectedItemCount) {
      throw new ConflictException(
        `Batch no longer matches: expected total ${expectedTotal.toString()} / ${expected.expectedItemCount} items, ` +
          `got ${actualTotal.toString()} / ${actualCount}`,
      );
    }
    if (actualTotal > BULK_BATCH_MAX_TOTAL_BASE_UNITS) {
      throw new ConflictException('Batch total exceeds the maximum allowed for a single confirm');
    }

    // MUST-FIX 2a — atomic claim. Only the request that flips
    // `draft -> confirming` proceeds.
    const claimed = await this.batchesRepo.update(
      { id: batch.id, status: 'draft' },
      { status: 'confirming' },
    );
    if (claimed.affected !== 1) {
      throw new ConflictException('Batch is not in a confirmable state (concurrent confirm?)');
    }
    batch.status = 'confirming';
    this.logger.log(`[STATE] bulk.confirmBatch batch claimed draft -> confirming batchId=${batch.id}`);
    this.logger.log(
      `[START] bulk.confirmBatch batchId=${batch.id} bitnobBatchId=${batch.bitnobBatchId} ` +
        `items=${actualCount} total=${actualTotal.toString()} environment=${this.environment()}`,
    );

    // MUST-FIX 3 — a failure here does NOT revert to `draft`.
    try {
      const data = unwrapBitnob<{ batch?: RemoteRecord }>(
        await this.http.post(`/api/bulk-transfers/${encodeURIComponent(batch.bitnobBatchId)}/confirm`, {}),
      );
      const mapped = mapBulkBatchStatus(data?.batch?.status, this.logger);
      batch.status = mapped || 'processing';
      batch.submittedAt = new Date();
      batch.rawResult = stripWithdrawalResultPii((data?.batch ?? {}) as RemoteRecord);
      await this.batchesRepo.save(batch);
      this.logger.log(`[RESULT] bulk.confirmBatch batchId=${batch.id} status=${batch.status}`);
      return { batch };
    } catch (err) {
      batch.status = 'confirm_uncertain';
      batch.rawResult = { error: summarizePayoutError(err) };
      await this.batchesRepo.save(batch).catch(() => undefined);
      this.logger.error(
        `[RESULT] bulk.confirmBatch batchId=${batch.id} status=confirm_uncertain — reconcile required ` +
          `detail=${summarizePayoutError(err)}`,
      );
      if (err instanceof HttpException) {
        throw err;
      }
      if (err instanceof BitnobApiError) {
        throw new BadGatewayException(
          'Bitnob bulk confirm did not return cleanly — the batch is left confirm_uncertain; reconcile to learn its true state',
        );
      }
      throw err;
    }
  }

  /**
   * `POST /api/bulk-transfers/:batchId/retry` — re-send named FAILED items.
   * Money-moving.
   *
   * B1 — `retry` has NEITHER a CAS-able batch transition NOR an idempotency
   * key (unlike `confirm`). Two concurrent admin retries of the same failed
   * items would each pass a naive `status === 'failed'` read and each POST to
   * Bitnob -> double on-chain send. Guard: an atomic
   * `failed -> processing` claim on the exact item set BEFORE the Bitnob call;
   * `affected !== itemIds.length` -> `ConflictException`.
   *
   * On a failed/lost Bitnob response the items are NOT reverted to `failed`
   * (same no-idempotency-key logic as `confirmBatch`): a revert + re-retry
   * after a lost response would double-send. They stay `processing` and an
   * explicit `reconcile` must resolve them.
   *
   * PROD-GATE-LIFT BLOCKER (security-analyst M5, Increment 5): this claims
   * items purely on the LOCAL `status === 'failed'` — it does not re-check
   * remote state. Once a webhook (`dispatchTransferEvent`) or a stale
   * reconcile can write `failed`, a mismatched `transfer.failed` becomes
   * sufficient justification for a double on-chain send. Before the bulk
   * production gate is lifted, `retryItems` MUST first
   * `GET /api/bulk-transfers/:id` and only re-send items Bitnob also reports
   * failed. Tracked in `docs/KNOWN_ISSUES.md` alongside the withdrawal
   * content-key blocker. (Inert today: bulk is prod-disabled and M4 keeps
   * `transfer.*` from writing bulk items at all.)
   */
  async retryItems(
    localId: string,
    itemIds: string[],
  ): Promise<{ batch: BitnobBulkBatch; items: BitnobBulkBatchItem[] }> {
    this.assertProdDisabled('retry');

    const batch = await this.loadBatch(localId);
    if (!batch.bitnobBatchId) {
      throw new ConflictException('Batch has no Bitnob id — cannot retry');
    }

    const preItems = await this.itemsRepo.findBy({ id: In(itemIds), batchId: batch.id });
    if (preItems.length !== itemIds.length) {
      throw new NotFoundException('one or more item ids do not belong to this batch');
    }
    const bitnobItemIds = preItems
      .map((i) => i.bitnobItemId)
      .filter((v): v is string => typeof v === 'string');
    if (bitnobItemIds.length !== preItems.length) {
      throw new ConflictException('one or more items are missing their Bitnob id — reconcile first');
    }

    // B1 — atomic claim BEFORE the Bitnob call. One `UPDATE ... WHERE id IN
    // (...) AND batch_id = ... AND status = 'failed'`: a concurrent retry that
    // already flipped any of these rows makes `affected` fall short here.
    const claim = await this.itemsRepo.update(
      { id: In(itemIds), batchId: batch.id, status: 'failed' },
      { status: 'processing' },
    );
    if (claim.affected !== itemIds.length) {
      throw new ConflictException(
        'one or more items are not in a retryable state (only failed items, and not while another retry is in flight)',
      );
    }
    await this.itemsRepo.increment({ id: In(itemIds), batchId: batch.id }, 'retries', 1);
    await this.itemsRepo.update({ id: In(itemIds), batchId: batch.id }, { failureReason: null });
    this.logger.log(
      `[STATE] bulk.retryItems items claimed failed -> processing batchId=${batch.id} count=${itemIds.length}`,
    );

    this.logger.log(
      `[START] bulk.retryItems batchId=${batch.id} items=${itemIds.length} environment=${this.environment()}`,
    );
    try {
      const data = unwrapBitnob<{ batch?: RemoteRecord }>(
        await this.http.post(`/api/bulk-transfers/${encodeURIComponent(batch.bitnobBatchId)}/retry`, {
          item_ids: bitnobItemIds,
        }),
      );
      const mapped = mapBulkBatchStatus(data?.batch?.status, this.logger);
      if (mapped) {
        batch.status = mapped;
      }
      batch.rawResult = stripWithdrawalResultPii((data?.batch ?? {}) as RemoteRecord);
      await this.batchesRepo.save(batch);
      const items = await this.itemsRepo.find({
        where: { batchId: batch.id },
        order: { rowIndex: 'ASC' },
      });
      this.logger.log(
        `[RESULT] bulk.retryItems batchId=${batch.id} retried=${itemIds.length} status=${batch.status}`,
      );
      return { batch, items };
    } catch (err) {
      // B1 / MUST-FIX 3 parity — do NOT revert the items to `failed`. Leave
      // them `processing`; the true outcome is uncertain until a reconcile.
      this.logger.error(
        `[RESULT] bulk.retryItems batchId=${batch.id} items left 'processing' — retry outcome uncertain, ` +
          `reconcile required detail=${summarizePayoutError(err)}`,
      );
      if (err instanceof HttpException) {
        throw err;
      }
      if (err instanceof BitnobApiError) {
        throw new BadGatewayException(
          'Bitnob bulk retry did not return cleanly — the items are left processing; reconcile to learn their true state',
        );
      }
      throw err;
    }
  }

  /** `GET /api/bulk-transfers` — proxied list, PII-scrubbed, cursor `next_page_token`. */
  async listBatches(
    query: ListBulkBatchesInput,
  ): Promise<{ batches: RemoteRecord[]; nextPageToken: string | null }> {
    const params: Record<string, string | number> = {};
    if (query.pageToken) params.page_token = query.pageToken;
    if (query.limit !== undefined) params.limit = query.limit;
    if (query.status) params.status = query.status;

    this.logger.log(
      `[START] bulk.listBatches status=${query.status ?? 'any'} limit=${query.limit ?? 'default'} ` +
        `cursor=${query.pageToken ? 'yes' : 'no'}`,
    );
    const data = unwrapBitnob<{ batches?: RemoteRecord[]; next_page_token?: unknown }>(
      await this.http.get('/api/bulk-transfers', params),
    );
    const batches = Array.isArray(data?.batches)
      ? data.batches.map((b) => stripWithdrawalResultPii(b))
      : [];
    const nextPageToken =
      typeof data?.next_page_token === 'string' && data.next_page_token.length > 0
        ? data.next_page_token
        : null;
    this.logger.log(`[RESULT] bulk.listBatches count=${batches.length} hasMore=${nextPageToken !== null}`);
    return { batches: batches as RemoteRecord[], nextPageToken };
  }

  /**
   * `POST /api/bitnob/bulk-transfers/:id/reconcile` — re-read the remote
   * batch and sync the local batch + item rows. This is the ONLY way a
   * `confirm_uncertain` batch is resolved.
   */
  async reconcileBatch(
    localId: string,
  ): Promise<{ batch: BitnobBulkBatch; items: BitnobBulkBatchItem[] }> {
    const batch = await this.loadBatch(localId);
    if (!batch.bitnobBatchId) {
      throw new ConflictException('Batch has no Bitnob id to reconcile');
    }

    this.logger.log(`[START] bulk.reconcileBatch batchId=${batch.id} bitnobBatchId=${batch.bitnobBatchId}`);
    const remote = await this.getBatch(batch.bitnobBatchId);

    if (remote.batch) {
      const mapped = mapBulkBatchStatus(remote.batch.status, this.logger);
      if (mapped) {
        batch.status = mapped;
      }
      batch.successCount = this.num(remote.batch.success_count) ?? batch.successCount;
      batch.failedCount = this.num(remote.batch.failed_count) ?? batch.failedCount;
      batch.totalItems = this.num(remote.batch.total_items) ?? batch.totalItems;
      batch.submittedAt = this.parseDate(remote.batch.submitted_at) ?? batch.submittedAt;
      batch.completedAt = this.parseDate(remote.batch.completed_at) ?? batch.completedAt;
      batch.rawResult = stripWithdrawalResultPii(remote.batch);
      await this.batchesRepo.save(batch);
    }

    const localItems = await this.itemsRepo.find({ where: { batchId: batch.id } });
    for (const ri of remote.items) {
      const riId = this.str(ri.id);
      const riRow = this.num(ri.row_index);
      const match =
        (riId && localItems.find((li) => li.bitnobItemId === riId)) ||
        (riRow != null && localItems.find((li) => li.rowIndex === riRow)) ||
        null;
      if (!match) {
        continue;
      }
      if (riId) {
        match.bitnobItemId = riId;
      }
      if (typeof ri.status === 'string' && ri.status.length > 0) {
        match.status = ri.status.toLowerCase();
      }
      match.failureReason = (emptyToNull(ri.failure_reason) as string | null) ?? match.failureReason;
      const wId = this.str(ri.withdrawal_id);
      if (wId) {
        match.withdrawalId = wId;
      }
      const retries = this.num(ri.retries);
      if (retries != null) {
        match.retries = retries;
      }
    }
    await this.itemsRepo.save(localItems);
    this.logger.log(`[RESULT] bulk.reconcileBatch batchId=${batch.id} status=${batch.status} items=${localItems.length}`);
    return { batch, items: localItems };
  }

  // --- helpers ---------------------------------------------------------------

  private async loadBatch(localId: string): Promise<BitnobBulkBatch> {
    const batch = await this.batchesRepo.findOne({ where: { id: localId } });
    if (!batch) {
      throw new NotFoundException('Bitnob bulk batch not found');
    }
    return batch;
  }

  private async findByIdempotencyKey(
    key: string,
  ): Promise<{ batch: BitnobBulkBatch; items: BitnobBulkBatchItem[] } | null> {
    const batch = await this.batchesRepo.findOne({ where: { idempotencyKey: key } });
    if (!batch) {
      return null;
    }
    const items = await this.itemsRepo.find({ where: { batchId: batch.id }, order: { rowIndex: 'ASC' } });
    return { batch, items };
  }

  /**
   * `@security-analyst` advisory: a bulk batch that pays the same destination
   * address twice is almost always a mistake. Enforced HERE (not in the
   * controller) because this service is exported and must self-guard. Case-
   * insensitive (EVM addresses are checksum-cased).
   */
  private assertNoDuplicateAddresses(items: BulkDraftItemInput[]): void {
    const seen = new Set<string>();
    for (const it of items) {
      const key = it.address.toLowerCase();
      if (seen.has(key)) {
        throw new BadRequestException('bulk transfer contains duplicate destination addresses');
      }
      seen.add(key);
    }
  }

  /**
   * BigInt backstop behind the DTO regexes: every item amount `> 0`, within
   * `[WITHDRAWAL_MIN_BASE_UNITS, WITHDRAWAL_MAX_BASE_UNITS]`, USDT/USDC only;
   * the batch total within `BULK_BATCH_MAX_TOTAL_BASE_UNITS`. Returns the sum.
   */
  private assertItemAmounts(items: BulkDraftItemInput[]): bigint {
    let total = 0n;
    for (const it of items) {
      if (!(BITNOB_WITHDRAWAL_CURRENCIES as readonly string[]).includes(it.currency)) {
        throw new BadRequestException('every bulk item currency must be USDT or USDC this increment');
      }
      let v: bigint;
      try {
        v = BigInt(it.amount);
      } catch {
        throw new BadRequestException('a bulk item amount is not a valid base-unit integer');
      }
      if (v < WITHDRAWAL_MIN_BASE_UNITS) {
        throw new BadRequestException('a bulk item amount is below the $10 minimum');
      }
      if (v > WITHDRAWAL_MAX_BASE_UNITS) {
        throw new BadRequestException('a bulk item amount exceeds the per-item ceiling');
      }
      total += v;
    }
    if (total > BULK_BATCH_MAX_TOTAL_BASE_UNITS) {
      throw new BadRequestException('the bulk batch total exceeds the maximum allowed');
    }
    return total;
  }

  private applyRemoteItemIds(local: BitnobBulkBatchItem[], remote: RemoteRecord[]): void {
    for (const ri of remote) {
      const riId = this.str(ri.id);
      const riRow = this.num(ri.row_index);
      const match =
        (riRow != null && local.find((li) => li.rowIndex === riRow)) ||
        (riId && local.find((li) => li.bitnobItemId === riId)) ||
        null;
      if (match && riId) {
        match.bitnobItemId = riId;
      }
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: unknown }).code === '23505'
    );
  }

  /** Drop `undefined` keys so they never reach the signed wire body. */
  private compact<T extends Record<string, unknown>>(obj: T): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        out[k] = v;
      }
    }
    return out as T;
  }

  private coerceEmpty(rec: RemoteRecord): RemoteRecord {
    const out: RemoteRecord = {};
    for (const [k, v] of Object.entries(rec)) {
      out[k] = emptyToNull(v);
    }
    return out;
  }

  private str(v: unknown): string | null {
    return typeof v === 'string' && v.length > 0 ? v : null;
  }

  private num(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) {
      return v;
    }
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
    return null;
  }

  private parseDate(v: unknown): Date | null {
    if (typeof v !== 'string' || v.trim() === '') {
      return null;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t) : null;
  }
}
