import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Organization } from '../../../modules/identity/entities/organization.entity';

/**
 * One row per Bitnob bulk-transfer batch, persisted at `status: 'draft'`
 * BEFORE `POST /api/bulk-transfers` so the local ledger owns the batch from
 * the first moment.
 *
 * Lifecycle (see `withdrawals.util.ts` for the full vocabulary):
 *
 *   draft -> confirming -> processing -> completed | failed
 *                       \-> confirm_uncertain   (confirm threw after the CAS)
 *   draft -> cancelled
 *
 * `confirming` / `confirm_uncertain` are LOCAL-ONLY transient states.
 * `confirm` is the irreversible disbursement of N transfers and has NO
 * idempotency key, so on a failed/lost confirm response the batch is left at
 * `confirm_uncertain` (NEVER reverted to `draft`) and an explicit reconcile
 * against `GET /api/bulk-transfers/:id` must resolve it.
 *
 * `idempotency_key` is the caller-supplied dedup key (nullable — a batch
 * created without one is not deduplicated, matching Bitnob). The partial
 * unique index `UQ_bitnob_bulk_batches_idempotency_key` enforces
 * at-most-once locally for the keys that are set.
 *
 * `organization_id` stays null on the raw admin path; the FK is still
 * `ON DELETE RESTRICT`. `total_amount` is the base-unit sum of the item
 * amounts, recomputed from the persisted items at confirm time and checked
 * against the caller's `expectedTotal`. Money columns are `numeric`
 * (string). `raw_result` is scrubbed before persistence.
 */
@Entity({ name: 'bitnob_bulk_batches' })
@Index('UQ_bitnob_bulk_batches_idempotency_key', ['idempotencyKey'], {
  unique: true,
  where: `"idempotency_key" IS NOT NULL`,
})
export class BitnobBulkBatch extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @ManyToOne(() => Organization, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization | null;

  @Column({ name: 'idempotency_key', type: 'varchar', nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'bitnob_batch_id', type: 'varchar', nullable: true })
  bitnobBatchId: string | null;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', default: 'draft' })
  status: string;

  @Column({ name: 'total_items', type: 'int', nullable: true })
  totalItems: number | null;

  @Column({ name: 'total_amount', type: 'numeric', nullable: true })
  totalAmount: string | null;

  @Column({ name: 'success_count', type: 'int', nullable: true })
  successCount: number | null;

  @Column({ name: 'failed_count', type: 'int', nullable: true })
  failedCount: number | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'raw_result', type: 'jsonb', nullable: true })
  rawResult: Record<string, unknown> | null;
}
