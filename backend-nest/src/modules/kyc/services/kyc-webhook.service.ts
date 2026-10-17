import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { KycWebhookEvent } from '../entities/kyc-webhook-event.entity';
import { KycService } from './kyc.service';

/** Idswyft events that mean "the verdict may have changed": the signal to re-read the status. */
const VERDICT_EVENTS = new Set(['verification.completed', 'verification.failed', 'verification.manual_review']);
const PG_UNIQUE_VIOLATION = '23505';
const MAX_FIELD_LENGTH = 64;
/** A worker's claim on a delivery; after this a redelivery may take it over (the worker died or hung). */
const CLAIM_LEASE = '2 minutes';

export interface KycWebhookResult {
  received: true;
  duplicate?: boolean;
}

/**
 * Handles Idswyft webhook deliveries. The delivery is only a SIGNAL: the verdict is always re-read from Idswyft
 * (`KycService.refreshFromProvider`) before a dossier becomes `verified`, so even a forged-but-validly-signed
 * body cannot grant a verification. Idswyft retries only on 5xx / network errors and treats any 4xx as
 * delivered, so a transient failure answers 503 and everything else answers 200.
 */
@Injectable()
export class KycWebhookService {
  private readonly logger = new Logger(KycWebhookService.name);

  constructor(
    @InjectRepository(KycWebhookEvent)
    private readonly eventsRepository: Repository<KycWebhookEvent>,
    private readonly kycService: KycService,
  ) {}

  async handle(
    deliveryId: string | null,
    payload: Record<string, unknown>,
    signatureValid: boolean,
  ): Promise<KycWebhookResult> {
    const safePayload = this.sanitizePayload(payload);
    const eventType = (safePayload.event as string | undefined) ?? 'unknown';
    this.logger.log(`[START] kyc webhook eventType=${eventType} deliveryId=${deliveryId ?? 'n/a'} signatureValid=${signatureValid}`);

    const record = await this.recordEvent(deliveryId, eventType, safePayload, signatureValid);
    if (record === null || record.processed || !(await this.claim(record))) {
      this.logger.log(`[RESULT] kyc webhook duplicate or in progress deliveryId=${deliveryId ?? 'n/a'}`);
      return { received: true, duplicate: true };
    }

    if (!signatureValid) {
      // Dev no-secret path: kept for inspection, never acted upon, and closed so it is not retried.
      await this.finish(record, 'unsigned');
      this.logger.warn(`[RESULT] kyc webhook stored but not acted upon (unsigned) eventId=${record.id}`);
      return { received: true };
    }

    if (VERDICT_EVENTS.has(eventType)) {
      const verificationId = safePayload.verification_id;
      const verification = typeof verificationId === 'string' ? await this.kycService.findByProviderVerificationId(verificationId) : null;
      this.logger.log(`[ENTITY] kyc webhook providerVerificationId=${String(verificationId ?? 'n/a')} found=${verification !== null}`);

      if (verification === null) {
        await this.finish(record, 'unknown_verification');
        return { received: true };
      }
      try {
        await this.kycService.refreshFromProvider(verification);
      } catch (error) {
        // Leave `processed = false` and answer 5xx: Idswyft redelivers with the same delivery id.
        await this.eventsRepository.update({ id: record.id }, { processingError: `refresh_failed:${(error as Error).name}`, processingStartedAt: null });
        this.logger.error(`[RESULT] kyc webhook refresh failed eventId=${record.id} reason=${(error as Error).name}`);
        throw new ServiceUnavailableException('Verification status could not be read back; retry');
      }
    }

    await this.finish(record, null);
    this.logger.log(`[STATE] kyc webhook processed eventId=${record.id} eventType=${eventType}`);
    return { received: true };
  }

  /**
   * Stores the delivery before anything else. Returns the row to process, or `null` for a concurrent duplicate
   * (unique `event_id`). An existing row that never finished processing is returned again so a redelivery retries it.
   */
  private async recordEvent(
    deliveryId: string | null,
    eventType: string,
    payload: Record<string, unknown>,
    signatureValid: boolean,
  ): Promise<KycWebhookEvent | null> {
    if (deliveryId) {
      const existing = await this.eventsRepository.findOne({ where: { eventId: deliveryId } });
      if (existing) {
        if (!existing.processed && signatureValid && !existing.signatureValid) {
          await this.eventsRepository.update({ id: existing.id }, { signatureValid: true });
          existing.signatureValid = true;
        }
        return existing;
      }
    }
    try {
      return await this.eventsRepository.save(
        this.eventsRepository.create({ eventId: deliveryId, eventType, payload, signatureValid, processed: false }),
      );
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string } | undefined)?.code === PG_UNIQUE_VIOLATION) {
        return null;
      }
      throw error;
    }
  }

  /** `UPDATE ... WHERE processed = false AND (no claim OR claim expired)`: exactly one concurrent worker wins. */
  private async claim(record: KycWebhookEvent): Promise<boolean> {
    const claimed = await this.eventsRepository
      .createQueryBuilder()
      .update(KycWebhookEvent)
      .set({ processingStartedAt: () => 'now()' })
      .where(`id = :id AND processed = false AND (processing_started_at IS NULL OR processing_started_at < now() - interval '${CLAIM_LEASE}')`, { id: record.id })
      .execute();
    return Boolean(claimed.affected);
  }

  private async finish(record: KycWebhookEvent, processingError: string | null): Promise<void> {
    await this.eventsRepository.update({ id: record.id }, { processed: true, processingError });
  }

  /**
   * Keeps four short scalar fields. Everything else — notably `data.ocr_data` (name, birth date, document
   * number) — is dropped, so personal data never reaches the database or the logs.
   */
  private sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const safe: Record<string, unknown> = {};
    for (const key of ['event', 'verification_id', 'status', 'timestamp'] as const) {
      const value = (payload ?? {})[key];
      if (typeof value === 'string' && value.length > 0) {
        safe[key] = value.slice(0, MAX_FIELD_LENGTH).replace(/[^\x20-\x7e]/g, '');
      }
    }
    return safe;
  }
}
