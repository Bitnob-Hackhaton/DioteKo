import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Did } from '../../../modules/did-vc/entities/did.entity';
import { Organization } from '../../../modules/identity/entities/organization.entity';

/**
 * One row per executed Bitnob trade (e.g. BTC/fiat spot). No service writes
 * this table yet — the trading methods were removed from `BitnobService`
 * pending verification against Bitnob's real trading API. The table/entity
 * are kept so the schema is ready when the trading family is rebuilt; at
 * that point the writer should mirror `BitnobPayout`'s quote/execute split
 * (a quote is a pure pricing lookup with no durable id, so only the execute
 * call persists a row).
 *
 * `quantity` is `numeric` (string on the entity) for the same
 * float-precision reason as `BitnobPayout.amount`. `status` is a plain
 * string for the same reason too — see that entity's doc comment.
 */
@Entity({ name: 'bitnob_trades' })
export class BitnobTrade extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'subject_did_id', type: 'uuid', nullable: true })
  subjectDidId: string | null;

  @ManyToOne(() => Did, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subject_did_id' })
  subjectDid: Did | null;

  @Column({ name: 'trade_id', type: 'varchar' })
  tradeId: string;

  @Column({ name: 'base_currency', type: 'varchar' })
  baseCurrency: string;

  @Column({ name: 'quote_currency', type: 'varchar' })
  quoteCurrency: string;

  @Column({ type: 'varchar' })
  side: string;

  @Column({ type: 'numeric' })
  quantity: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: string;
}
