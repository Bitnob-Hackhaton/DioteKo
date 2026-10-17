import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { BitnobBulkBatch } from './bitnob-bulk-batch.entity';

/**
 * One row per line item in a Bitnob bulk-transfer batch. Persisted alongside
 * the parent `bitnob_bulk_batches` row at draft time.
 *
 * Item lifecycle: `pending -> processing -> confirmed | failed`
 * (`confirmed` == the item's on-chain transfer succeeded). `withdrawal_id`
 * is Bitnob's per-item withdrawal id, populated once the item is sent —
 * a bulk item resolves to a withdrawal.
 *
 * The `batch_id` FK is `ON DELETE RESTRICT`, matching every other
 * money-adjacent FK in the schema (`bitnob_payouts.*`, `bitnob_trades.*`,
 * `admin_certificates_refs.*`). A batch item is a money-movement record with
 * independent forensic value (`amount`, `address`, `withdrawal_id` — the
 * pointer to Bitnob's authoritative per-item record), so it must not be
 * silently wiped by a `DELETE FROM bitnob_bulk_batches`. The app has no
 * batch-delete path, so RESTRICT enforces structurally what convention
 * already assumed.
 *
 * `amount` is a base-unit integer string (`numeric` -> string on the entity).
 */
@Entity({ name: 'bitnob_bulk_batch_items' })
@Index('IDX_bitnob_bulk_batch_items_batch_id', ['batchId'])
export class BitnobBulkBatchItem extends BaseEntity {
  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @ManyToOne(() => BitnobBulkBatch, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'batch_id',
    foreignKeyConstraintName: 'FK_bitnob_bulk_batch_items_batch',
  })
  batch: BitnobBulkBatch;

  @Column({ name: 'bitnob_item_id', type: 'varchar', nullable: true })
  bitnobItemId: string | null;

  @Column({ name: 'row_index', type: 'int', nullable: true })
  rowIndex: number | null;

  @Column({ type: 'varchar' })
  chain: string;

  @Column({ type: 'varchar' })
  currency: string;

  @Column({ type: 'varchar' })
  address: string;

  @Column({ type: 'numeric' })
  amount: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: string;

  @Column({ name: 'failure_reason', type: 'varchar', nullable: true })
  failureReason: string | null;

  @Column({ type: 'int', default: 0 })
  retries: number;

  @Column({ name: 'withdrawal_id', type: 'varchar', nullable: true })
  withdrawalId: string | null;

  @Column({ name: 'raw_result', type: 'jsonb', nullable: true })
  rawResult: Record<string, unknown> | null;
}
