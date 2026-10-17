import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Append-only log of Idswyft webhook deliveries, same role as `bitnob_webhook_events`: written first, so a
 * sanitized copy survives a failure in dispatch, and `event_id` (the `X-Idswyft-Webhook-Id` header) is unique so
 * a redelivery is recognised and not processed twice. The payload is stored WITHOUT personal data — only the
 * fields kept by `KycWebhookService.sanitizePayload`.
 */
@Entity({ name: 'kyc_webhook_events' })
export class KycWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_id', type: 'varchar', nullable: true, unique: true })
  eventId: string | null;

  @Column({ name: 'event_type', type: 'varchar' })
  eventType: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  processed: boolean;

  /** `false` only on the dev no-secret skip path; such an event is stored but never acted on. */
  @Column({ name: 'signature_valid', type: 'boolean', default: true })
  signatureValid: boolean;

  /** Set when a worker claims the delivery; a claim older than the lease may be taken over by a redelivery. */
  @Column({ name: 'processing_started_at', type: 'timestamptz', nullable: true })
  processingStartedAt: Date | null;

  /** A fixed code or error class name — never a provider message. */
  @Column({ name: 'processing_error', type: 'text', nullable: true })
  processingError: string | null;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;
}
