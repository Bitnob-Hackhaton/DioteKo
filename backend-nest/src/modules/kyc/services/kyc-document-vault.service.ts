import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { KycDocument } from '../entities/kyc-document.entity';
import { decryptDocument, encryptDocument } from '../kyc-document-crypto.util';
import { KYC_DOCUMENT_KINDS, KycDocumentKind } from '../kyc.constants';

const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The only place a holder's photo is written down. A copy exists only when an agent may have to look at the dossier
 * (`KYC_FALLBACK_MANUAL_REVIEW=on` or `KYC_PROVIDER_MODE=manual_only`), is AES-256-GCM encrypted with
 * `KYC_DOC_ENCRYPTION_KEY`, and is deleted at the agent's decision, when the provider verifies the dossier, or at
 * `expires_at`. Without a valid key nothing is kept (and nothing is ever logged about the content).
 */
@Injectable()
export class KycDocumentVaultService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KycDocumentVaultService.name);
  private purgeTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(KycDocument)
    private readonly documentsRepository: Repository<KycDocument>,
    private readonly configService: ConfigService,
  ) {}

  /** Retention does not depend on anyone opening the review queue: purge at boot, then every hour. */
  onModuleInit(): void {
    const purge = () => void this.purgeExpired().catch((error: Error) => this.logger.warn(`[RESULT] kyc documents purge failed reason=${error.name}`));
    purge();
    this.purgeTimer = setInterval(purge, PURGE_INTERVAL_MS);
    this.purgeTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.purgeTimer);
  }

  private get key(): string {
    return this.configService.get<string>('kyc.docEncryptionKey', '');
  }

  /** A key is configured, so copies can be encrypted. */
  get canStore(): boolean {
    return this.key !== '';
  }

  /** Flags say an agent may need the photos. */
  get wanted(): boolean {
    return (
      this.configService.get<boolean>('kyc.fallbackManualReview', false) ||
      this.configService.get<string>('kyc.providerMode', 'idswyft') === 'manual_only'
    );
  }

  /**
   * Keeps (or replaces) the encrypted copy of one side. No-op unless copies are wanted and a key exists. The write is
   * conditional on the dossier still being `pending` (one statement), so a photo can neither replace what an agent is
   * looking at nor be written after the decision. Returns false when nothing was written.
   */
  async store(verificationId: string, kind: KycDocumentKind, file: { buffer: Buffer; mimetype: string }): Promise<boolean> {
    if (!this.wanted || !this.canStore) return false;
    const retentionDays = this.configService.get<number>('kyc.docRetentionDays', 30);
    const encrypted = encryptDocument(this.key, verificationId, kind, file.buffer);
    const rows: unknown[] = await this.documentsRepository.query(
      `INSERT INTO "kyc_documents" ("verification_id", "kind", "mime", "iv", "auth_tag", "ciphertext", "expires_at")
       SELECT $1, $2, $3, $4, $5, $6, $7
       WHERE EXISTS (SELECT 1 FROM "kyc_verifications" WHERE "id" = $1 AND "status" = 'pending')
       ON CONFLICT ("verification_id", "kind") DO UPDATE
         SET "mime" = EXCLUDED."mime", "iv" = EXCLUDED."iv", "auth_tag" = EXCLUDED."auth_tag",
             "ciphertext" = EXCLUDED."ciphertext", "expires_at" = EXCLUDED."expires_at", "created_at" = now()
       RETURNING "id"`,
      [verificationId, kind, file.mimetype, encrypted.iv, encrypted.authTag, encrypted.ciphertext, new Date(Date.now() + retentionDays * DAY_MS)],
    );
    if (rows.length === 0) {
      this.logger.warn(`[RESULT] kyc document not kept verificationId=${verificationId} kind=${kind} reason=not_pending`);
      return false;
    }
    this.logger.log(`[STATE] kyc document kept verificationId=${verificationId} kind=${kind} bytes=${file.buffer.length}`);
    return true;
  }

  /** Sides currently kept for a dossier (no content read). */
  async kindsFor(verificationId: string): Promise<KycDocumentKind[]> {
    const rows = await this.documentsRepository.find({ where: { verificationId }, select: { kind: true } });
    const kept = new Set(rows.map((row) => row.kind));
    return KYC_DOCUMENT_KINDS.filter((kind) => kept.has(kind));
  }

  /** Decrypts one side for an agent; `null` when absent, expired, or when the key no longer opens it. */
  async read(verificationId: string, kind: KycDocumentKind): Promise<{ buffer: Buffer; mimetype: string } | null> {
    if (!this.canStore) return null;
    const row = await this.documentsRepository.findOne({ where: { verificationId, kind } });
    if (!row || row.expiresAt.getTime() <= Date.now()) return null;
    try {
      const buffer = decryptDocument(this.key, verificationId, kind, { iv: row.iv, authTag: row.authTag, ciphertext: row.ciphertext });
      return { buffer, mimetype: row.mime };
    } catch {
      // Wrong key (rotated) or a row moved/tampered: the copy is unusable, say so without any detail.
      this.logger.error(`[RESULT] kyc document unreadable verificationId=${verificationId} kind=${kind} reason=decrypt_failed`);
      return null;
    }
  }

  async deleteFor(verificationId: string): Promise<void> {
    const deleted = await this.documentsRepository.delete({ verificationId });
    if (deleted.affected) this.logger.log(`[STATE] kyc documents deleted verificationId=${verificationId} count=${deleted.affected}`);
  }

  /** Retention: removes the copies nobody decided in time. Called when the review queue is read. */
  async purgeExpired(): Promise<number> {
    const deleted = await this.documentsRepository.delete({ expiresAt: LessThan(new Date()) });
    if (deleted.affected) this.logger.log(`[STATE] kyc documents expired and deleted count=${deleted.affected}`);
    return deleted.affected ?? 0;
  }
}
