import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Not, Repository } from 'typeorm';
import { AccessLogAction, AccessLogActorType, AccessLogResult } from '../../consent/entities/access-log.entity';
import { AccessLogService } from '../../consent/services/access-log.service';
import { AccountStatus, User } from '../../identity/entities/user.entity';
import { KycReviewDecision, ListKycReviewsQueryDto } from '../dto/kyc-review.dto';
import { KycVerification } from '../entities/kyc-verification.entity';
import { KycDocumentKind, kycRequiredKinds, KycReviewOrigin, KycStatus } from '../kyc.constants';
import { KycDocumentVaultService } from './kyc-document-vault.service';

const DOCUMENT_LABELS: Record<string, string> = {
  national_id: "Carte d'identité",
  passport: 'Passeport',
};

/** What the console shows. Staff-only: it carries the holder's name, never a document number or an image. */
export interface KycReviewView {
  id: string;
  reference: string;
  holderName: string;
  origin: KycReviewOrigin;
  documentType: string | null;
  issuingCountry: string | null;
  status: KycStatus;
  failureReason: string | null;
  createdAt: Date;
  availableDocuments: KycDocumentKind[];
  attempts: number;
  reviewedByName?: string;
  reviewedAt?: Date;
  reviewNote?: string;
}

/**
 * Agent review of identity dossiers sitting in `manual_review` (docs/PLAN_KYC_MANUAL_REVIEW.md). Same shape as the
 * certificate-request review: conditional write (409 when another agent decided first), four-eyes (nobody decides their
 * own dossier), and an audit entry per read of a document and per decision (refusals included). `verified` is written here and in
 * `KycService.refreshFromProvider` only.
 */
@Injectable()
export class KycReviewService {
  private readonly logger = new Logger(KycReviewService.name);

  constructor(
    @InjectRepository(KycVerification)
    private readonly verificationsRepository: Repository<KycVerification>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly vault: KycDocumentVaultService,
    private readonly accessLogService: AccessLogService,
  ) {}

  async list(actorUserId: string, query: ListKycReviewsQueryDto): Promise<{ items: KycReviewView[]; total: number; page: number; pageSize: number }> {
    this.logger.log(`[START] kyc review list actorUserId=${actorUserId} status=${query.status ?? 'manual_review'} origin=${query.origin ?? 'any'}`);
    await this.assertStaff(actorUserId);
    await this.vault.purgeExpired().catch(() => undefined);

    // History (verified / rejected) only lists dossiers an agent was involved in, never every provider-verified holder.
    const where: FindOptionsWhere<KycVerification> = {
      status: (query.status ?? KycStatus.MANUAL_REVIEW) as KycStatus,
      reviewOrigin: query.origin ?? Not(IsNull()),
    };
    const [rows, total] = await this.verificationsRepository.findAndCount({
      where,
      relations: { user: true, reviewer: true },
      order: { createdAt: 'ASC', id: 'ASC' },
      take: query.limit,
      skip: query.offset,
    });
    const items = await Promise.all(rows.map((row) => this.toView(row)));
    this.logger.log(`[RESULT] kyc review list count=${items.length} total=${total}`);
    return { items, total, page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit };
  }

  async get(actorUserId: string, id: string): Promise<KycReviewView> {
    await this.assertStaff(actorUserId);
    const row = await this.findReviewable(id);
    await this.audit(actorUserId, row, AccessLogAction.READ, AccessLogResult.VALID, { holderUserId: row.userId });
    return this.toView(row);
  }

  /** One decrypted side for the agent's eyes. Audited: who looked at which holder's document. */
  async getDocument(actorUserId: string, id: string, kind: KycDocumentKind): Promise<{ buffer: Buffer; mimetype: string }> {
    this.logger.log(`[START] kyc review document actorUserId=${actorUserId} sessionId=${id} kind=${kind}`);
    await this.assertStaff(actorUserId);
    const row = await this.findReviewable(id);
    // Photos are only for a dossier waiting for a decision; a decided one has none left anyway.
    if (row.status !== KycStatus.MANUAL_REVIEW) throw new NotFoundException('Document not available');
    const document = await this.vault.read(row.id, kind);
    if (!document) {
      this.logger.warn(`[RESULT] kyc review document missing sessionId=${id} kind=${kind}`);
      throw new NotFoundException('Document not available');
    }
    await this.audit(actorUserId, row, AccessLogAction.READ, AccessLogResult.VALID, { holderUserId: row.userId, document: kind });
    return document;
  }

  async decide(actorUserId: string, id: string, decision: KycReviewDecision, note: string): Promise<{ id: string; status: KycStatus }> {
    this.logger.log(`[START] kyc review decide actorUserId=${actorUserId} sessionId=${id} decision=${decision}`);
    await this.assertStaff(actorUserId);
    const row = await this.findReviewable(id);

    // Four-eyes: an agent who is also the holder of the dossier cannot validate their own identity.
    if (row.userId === actorUserId) {
      this.logger.warn(`[RESULT] kyc review decide refused sessionId=${id} reason=own_dossier`);
      await this.audit(actorUserId, row, AccessLogAction.REVIEW, AccessLogResult.INVALID, { holderUserId: row.userId, decision, refused: 'own_dossier' });
      throw new ForbiddenException('You cannot review your own identity verification');
    }
    if (row.status !== KycStatus.MANUAL_REVIEW) {
      throw new ConflictException('This verification has already been reviewed');
    }

    // No blind approval: the agent must have had every photo to compare (a provider-origin dossier may have none).
    if (decision === 'approve') {
      const kept = await this.vault.kindsFor(row.id);
      if (!kycRequiredKinds(row.documentType).every((kind) => kept.includes(kind))) {
        this.logger.warn(`[RESULT] kyc review decide refused sessionId=${id} reason=photos_missing`);
        throw new ConflictException('The documents are not all available: reject this verification so the holder can start again');
      }
    }

    const status = decision === 'approve' ? KycStatus.VERIFIED : KycStatus.REJECTED;
    const now = new Date();
    const written = await this.verificationsRepository.update(
      { id: row.id, status: KycStatus.MANUAL_REVIEW },
      {
        status,
        verifiedAt: status === KycStatus.VERIFIED ? now : null,
        failureReason: status === KycStatus.REJECTED ? 'rejected' : null,
        reviewedBy: actorUserId,
        reviewedAt: now,
        reviewNote: note.trim(),
      },
    );
    if (!written.affected) {
      // Another agent decided between our read and our write: trust the stored row, never overwrite it.
      this.logger.warn(`[RESULT] kyc review decide lost the race sessionId=${id}`);
      await this.audit(actorUserId, row, AccessLogAction.REVIEW, AccessLogResult.INVALID, { holderUserId: row.userId, decision, refused: 'already_reviewed' });
      throw new ConflictException('This verification has already been reviewed');
    }

    // Audit first: if the cleanup fails the decision is still on record (the copies then expire on their own).
    await this.audit(actorUserId, row, AccessLogAction.REVIEW, AccessLogResult.VALID, { holderUserId: row.userId, decision });
    await this.vault.deleteFor(row.id);
    this.logger.log(`[STATE] kyc review decided sessionId=${id} decision=${decision} status=${status}`);
    return { id: row.id, status };
  }

  /** Review is a staff action: the account must belong to an organization (same rule as the certificate review). */
  private async assertStaff(actorUserId: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id: actorUserId } });
    // The JWT carries roles for its whole life: a suspended agent must be refused here, not only at the next login.
    if (!user || user.accountStatus !== AccountStatus.ACTIVE || !user.organizationId) {
      this.logger.warn(`[RESULT] kyc review refused actorUserId=${actorUserId} reason=not_active_staff`);
      throw new ForbiddenException('Your account cannot review identity verifications');
    }
    return user;
  }

  private async findReviewable(id: string): Promise<KycVerification> {
    const row = await this.verificationsRepository.findOne({
      where: { id, reviewOrigin: Not(IsNull()) },
      relations: { user: true, reviewer: true },
    });
    if (!row) throw new NotFoundException('Verification not found');
    return row;
  }

  private async toView(row: KycVerification): Promise<KycReviewView> {
    return {
      id: row.id,
      reference: `KYC-${row.id.slice(0, 8).toUpperCase()}`,
      holderName: row.user?.displayName ?? row.user?.email ?? '—',
      origin: row.reviewOrigin ?? 'provider',
      documentType: DOCUMENT_LABELS[row.documentType] ?? row.documentType,
      issuingCountry: row.issuingCountry,
      status: row.status,
      failureReason: row.failureReason,
      createdAt: row.createdAt,
      availableDocuments: await this.vault.kindsFor(row.id),
      attempts: row.attempts,
      ...(row.reviewer ? { reviewedByName: row.reviewer.displayName ?? row.reviewer.email ?? 'Agent' } : {}),
      ...(row.reviewedAt ? { reviewedAt: row.reviewedAt } : {}),
      ...(row.reviewNote ? { reviewNote: row.reviewNote } : {}),
    };
  }

  private audit(actorUserId: string, row: KycVerification, action: AccessLogAction, result: AccessLogResult, metadata: Record<string, unknown>) {
    return this.accessLogService.record({
      actorType: AccessLogActorType.ISSUER_ORGANIZATION,
      actorUserId,
      resourceType: 'kyc_verification',
      resourceId: row.id,
      action,
      result,
      // Ids and the decision only: no name, no number, no image.
      metadata,
    });
  }
}
