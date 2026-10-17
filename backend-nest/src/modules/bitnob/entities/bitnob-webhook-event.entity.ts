import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Append-only raw log of every Bitnob webhook payload received (all event
 * families via the catch-all `POST /api/bitnob/webhooks`, plus the legacy
 * `POST /api/bitnob/webhooks/cards`). Always written
 * FIRST by `BitnobWebhookService`, before any dispatch/lookup logic runs —
 * see that service's doc comment — so a raw copy of what Bitnob sent is
 * never lost even if downstream dispatch throws. `eventId` is nullable +
 * unique because not every payload is guaranteed to carry a stable
 * Bitnob-assigned event id (unconfirmed against live docs); when present it
 * prevents the same delivery from being double-recorded on a retry.
 * `processingError` is set (and `processed` still flips to `true`) when
 * dispatch throws, so a bad/unexpected payload is recorded rather than
 * leaving the event silently stuck.
 *
 * `signatureValid` records whether `BitnobWebhookSignatureGuard` verified the
 * `x-bitnob-signature` HMAC. `false` only on the dev no-secret skip path; an
 * event with `signatureValid = false` is persisted here but NEVER dispatched
 * (no money-table mutation), in any environment. Backfilled `true` for rows
 * that predate signature verification.
 */
@Entity({ name: 'bitnob_webhook_events' })
export class BitnobWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_id', type: 'varchar', nullable: true, unique: true })
  eventId: string | null;

  @Column({ name: 'event_type', type: 'varchar' })
  eventType: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;

  @Column({ type: 'boolean', default: false })
  processed: boolean;

  @Column({ name: 'signature_valid', type: 'boolean', default: true })
  signatureValid: boolean;

  @Column({ name: 'processing_error', type: 'text', nullable: true })
  processingError: string | null;
}
