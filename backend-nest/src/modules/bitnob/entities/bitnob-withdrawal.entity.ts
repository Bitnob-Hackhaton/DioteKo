import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Organization } from '../../../modules/identity/entities/organization.entity';

/**
 * One row per Bitnob on-chain withdrawal (a stablecoin transfer to an
 * external address), created up-front at `status: 'pending'` BEFORE the
 * Bitnob call so the deterministic idempotency key `reference = 'dkwd_' + id`
 * always exists and the local ledger never lags the remote state.
 *
 * Single-shot lifecycle (NOT the multi-step quote/initialize/finalize flow
 * `bitnob_payouts` uses):
 *
 *   pending -> submitted -> completed | failed
 *
 * See `withdrawals.util.ts` for the vocabulary. There is deliberately no
 * local CAS-transient status: the row is created and the Bitnob call made
 * inside one request, so two requests can't race on the same row.
 *
 * `reference` is Bitnob's only idempotency key — a repeat with the same
 * `reference` returns the ORIGINAL withdrawal (HTTP 409). The partial unique
 * index `UQ_bitnob_withdrawals_reference` mirrors `UQ_bitnob_payouts_reference`
 * and only covers non-null values (the row exists as `pending` with a null
 * `reference` for the brief window before the Bitnob call).
 *
 * DELIBERATELY NO `subject_did_id`: linking a citizen DID to an on-chain
 * address is a permanent, public correlation. This is the RAW admin path and
 * is not domain-scoped, so `organization_id` also stays null. The
 * `organization_id` FK is nonetheless `ON DELETE RESTRICT` (a money row must
 * never silently orphan) for the day a domain-scoped caller sets it.
 *
 * `amount` is a base-unit integer string (e.g. "10000000" == 10 USDT, 6
 * decimals) — `numeric` so TypeORM returns it as a string with no float
 * loss. `raw_result` is scrubbed via `stripWithdrawalResultPii` before it is
 * persisted.
 */
@Entity({ name: 'bitnob_withdrawals' })
@Index('UQ_bitnob_withdrawals_reference', ['reference'], {
  unique: true,
  where: `"reference" IS NOT NULL`,
})
export class BitnobWithdrawal extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @ManyToOne(() => Organization, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization | null;

  @Column({ type: 'varchar', nullable: true })
  reference: string | null;

  @Column({ name: 'transaction_id', type: 'varchar', nullable: true })
  transactionId: string | null;

  @Column({ name: 'to_address', type: 'varchar' })
  toAddress: string;

  @Column({ type: 'varchar' })
  chain: string;

  @Column({ type: 'varchar' })
  currency: string;

  @Column({ type: 'numeric' })
  amount: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  /**
   * On-chain transaction hash and network/gas fee, both populated from the
   * `transfer.success` / `transfer.failed` webhook (`data.hash` / `data.fee`)
   * — Increment 5. Null until a verified `transfer.*` event lands (or a
   * reconcile poll fills them). `network_fee` is a base-unit string (unit
   * unconfirmed against a live delivery — see the webhook contract memo).
   */
  @Column({ name: 'tx_hash', type: 'varchar', nullable: true })
  txHash: string | null;

  @Column({ name: 'network_fee', type: 'numeric', nullable: true })
  networkFee: string | null;

  @Column({ name: 'raw_result', type: 'jsonb', nullable: true })
  rawResult: Record<string, unknown> | null;
}
