import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, Not, Repository } from 'typeorm';
import { AccessLogAction, AccessLogActorType, AccessLogResult } from '../../consent/entities/access-log.entity';
import { AccessLogService } from '../../consent/services/access-log.service';
import { AccountStatus, User } from '../../identity/entities/user.entity';
import { KycReviewDecision, KycReviewListStatus, ListKycReviewsQueryDto } from '../dto/kyc-review.dto';
import { KycVerification } from '../entities/kyc-verification.entity';
import { assessmentHasReadings, KycAssessmentView } from '../kyc-assessment.util';
import { KycAutoAuditView } from '../kyc-auto-audit.util';
import { KYC_AUTO_ORIGIN, KycDocumentKind, kycRequiredKinds, KycReviewViewOrigin, KycStatus } from '../kyc.constants';
import { KycDocumentVaultService } from './kyc-document-vault.service';

const DOCUMENT_LABELS: Record<string, string> = {
  national_id: "Carte d'identité",
  passport: 'Passeport',
};

/**
 * What the console shows. Staff-only: it carries the holder's name and, on the detail route only, what the automatic
 * check read on the document (`assessment`, decrypted for this request). Never an image: those are served apart.
 */
export interface KycReviewView {
  id: string;
  reference: string;
  holderName: string;
  origin: KycReviewViewOrigin;
  documentType: string | null;
  issuingCountry: string | null;
  status: KycStatus;
  failureReason: string | null;
  createdAt: Date;
  /** Set for a verified dossier. */
  verifiedAt?: Date;
  availableDocuments: KycDocumentKind[];
  attempts: number;
  reviewedByName?: string;
  reviewedAt?: Date;
  reviewNote?: string;
  /** Detail route only, for a dossier waiting for a decision. Never in the list, never in a holder-facing view. */
  assessment?: KycAssessmentView;
  /**
   * Detail route only, for a dossier the provider verified by itself (origin `auto`): scores and flags, no photo, no OCR
   * text, no name (docs/KYC.md §17). Read-only: there is nothing to decide.
   */
  autoAudit?: KycAutoAuditView;
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
    const status = query.status ?? 'manual_review';
    this.logger.log(`[START] kyc review list actorUserId=${actorUserId} status=${status} origin=${query.origin ?? 'any'}`);
    await this.assertStaff(actorUserId);
    await this.vault.purgeExpired().catch(() => undefined);

    const where = this.listWhere(status, query.origin);
    if (!where) {
      // e.g. origin `auto` among the dossiers to review: no such dossier can exist.
      this.logger.log('[RESULT] kyc review list count=0 total=0 (filters cannot match)');
      return { items: [], total: 0, page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit };
    }
    const [rows, total] = await this.verificationsRepository.findAndCount({
      where,
      relations: { user: true, reviewer: true },
      // The work queue is served oldest first (first come, first served); every other view is a history, newest first.
      order: status === 'manual_review' ? { createdAt: 'ASC', id: 'ASC' } : { createdAt: 'DESC', id: 'DESC' },
      take: query.limit,
      skip: query.offset,
    });
    const items = await Promise.all(rows.map((row) => this.toView(row)));
    this.logger.log(`[RESULT] kyc review list count=${items.length} total=${total}`);
    return { items, total, page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit };
  }

  /**
   * What each state of the list shows. A dossier waiting for a decision or rejected is listed only if an agent was involved
   * (`review_origin` set); a verified one is listed whoever verified it: with `review_origin` set an agent (or the
   * fallback) was involved, with it NULL the provider verified it by itself (origin `auto`, read-only). `null` = nothing can match.
   */
  private listWhere(status: KycReviewListStatus, origin: KycReviewViewOrigin | undefined): FindOptionsWhere<KycVerification> | FindOptionsWhere<KycVerification>[] | null {
    if (origin === KYC_AUTO_ORIGIN) {
      return status === 'verified' || status === 'all' ? { status: KycStatus.VERIFIED, reviewOrigin: IsNull() } : null;
    }
    if (origin) {
      const statuses = status === 'all' ? In([KycStatus.MANUAL_REVIEW, KycStatus.VERIFIED, KycStatus.REJECTED]) : (status as KycStatus);
      return { status: statuses, reviewOrigin: origin };
    }
    if (status === 'verified') return { status: KycStatus.VERIFIED };
    if (status === 'all') {
      return [{ status: In([KycStatus.MANUAL_REVIEW, KycStatus.REJECTED]), reviewOrigin: Not(IsNull()) }, { status: KycStatus.VERIFIED }];
    }
    return { status: status as KycStatus, reviewOrigin: Not(IsNull()) };
  }

  async get(actorUserId: string, id: string): Promise<KycReviewView> {
    await this.assertStaff(actorUserId);
    const row = await this.findReviewable(id);
    const view = await this.toView(row);
    // The assessment is personal data read on a document: opening the dossier is audited with its state (never its content).
    if (row.status === KycStatus.MANUAL_REVIEW) view.assessment = await this.loadAssessment(row);
    // Verified by the provider alone: the reduced audit (scores and flags only), opened read-only and audited like the rest.
    if (view.origin === KYC_AUTO_ORIGIN) {
      const audit = await this.vault.readAutoAudit(row.id);
      view.autoAudit = audit ? { state: 'available', audit } : { state: 'unavailable', audit: null };
    }
    await this.audit(actorUserId, row, AccessLogAction.READ, AccessLogResult.VALID, {
      holderUserId: row.userId,
      ...(view.assessment ? { assessment: view.assessment.state } : {}),
      ...(view.autoAudit ? { autoAudit: view.autoAudit.state } : {}),
    });
    return view;
  }

  /**
   * What the automatic check produced for this dossier, decrypted. Four states, so the agent never faces an empty form
   * without knowing why: `available` (readings), `no_data` (the provider answered but read nothing, maybe with a
   * rejection code), `unavailable` (nothing kept: outage, expired, key rotated, flag off) and `not_run` (manual-only
   * mode: there was no automatic check).
   */
  private async loadAssessment(row: KycVerification): Promise<KycAssessmentView> {
    if (row.reviewOrigin === 'manual_only') return { state: 'not_run', assessment: null };
    const assessment = await this.vault.readAssessment(row.id);
    if (!assessment) return { state: 'unavailable', assessment: null };
    return { state: assessmentHasReadings(assessment) ? 'available' : 'no_data', assessment };
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
    // Reviewable = an agent was involved, or the provider verified it by itself (read-only: `decide` refuses it with 409).
    const row = await this.verificationsRepository.findOne({
      where: [{ id, reviewOrigin: Not(IsNull()) }, { id, status: KycStatus.VERIFIED }],
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
      origin: row.reviewOrigin ?? (row.status === KycStatus.VERIFIED ? KYC_AUTO_ORIGIN : 'provider'),
      documentType: DOCUMENT_LABELS[row.documentType] ?? row.documentType,
      issuingCountry: row.issuingCountry,
      status: row.status,
      failureReason: row.failureReason,
      createdAt: row.createdAt,
      ...(row.status === KycStatus.VERIFIED && row.verifiedAt ? { verifiedAt: row.verifiedAt } : {}),
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
