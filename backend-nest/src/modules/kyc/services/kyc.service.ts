import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, MoreThan, QueryFailedError, Repository } from 'typeorm';
import { AccountStatus, User } from '../../identity/entities/user.entity';
import { KycVerification } from '../entities/kyc-verification.entity';
import {
  KYC_DOCUMENT_TYPES_WITH_BACK,
  KYC_FAILURE_REASONS,
  KYC_MANUAL_PROVIDER_ID_PREFIX,
  KYC_PROVIDER_IDSWYFT,
  KYC_PROVIDER_TIMEOUT_CODE,
  KYC_PROVIDER_UNREACHABLE_CODE,
  KYC_REQUIRED_CODE,
  kycRequiredKinds,
  KycDocumentType,
  KycFailureReason,
  KycReviewOrigin,
  KycStatus,
} from '../kyc.constants';
import { assessmentDigest, KycAssessment } from '../kyc-assessment.util';
import { KycAutoAudit } from '../kyc-auto-audit.util';
import { isKycEnforced, KycPolicy } from '../kyc-policy.util';
import { backPrecheckVerdict, KycPrecheckResult, looksLikeDocumentFront } from '../kyc-precheck.util';
import { KycDocumentVaultService } from './kyc-document-vault.service';
import { IdswyftEngineClientService } from './idswyft-engine-client.service';
import { IdswyftApiError, IdswyftHttpClientService, IdswyftStatusView, IdswyftUploadStep } from './idswyft-http-client.service';

/** Uploads (front + back + selfie, with retakes) one session may send before the holder must start over. */
export const KYC_MAX_UPLOADS_PER_SESSION = 8;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A pending dossier untouched for this long is closed as `expired` when the holder starts again. */
const STALE_PENDING_MS = DAY_MS;
const PG_UNIQUE_VIOLATION = '23505';
/** Minimum gap between two provider reads of the same dossier triggered by status polling. */
const REFRESH_MIN_INTERVAL_MS = 3000;
/** Prechecks allowed per session in the sliding window (the app probes every few seconds while the holder aims). */
const PRECHECK_WINDOW_MS = 5 * 60 * 1000;
const PRECHECK_MAX_PER_WINDOW = 100;
/** Statuses in which the provider may still change its mind: the only ones a write may leave. */
const OPEN_STATUSES = [KycStatus.PENDING, KycStatus.MANUAL_REVIEW];

/** What the holder sees: never the provider id, the user id or anything read from a document. */
export interface KycStatusView {
  /** `not_started` when the holder has no dossier yet. */
  status: KycStatus | 'not_started';
  sessionId: string | null;
  documentType: string | null;
  attempts: number;
  verifiedAt: Date | null;
  /** One of `KYC_FAILURE_REASONS`; never provider free text. */
  failureReason: string | null;
  /** True once the dossier is failed/rejected: a new session may be opened (within the daily cap). */
  canRestart: boolean;
  /** Photo the provider expects next on an open session, so the app resumes there; `null` when unknown. */
  nextStep: KycPhotoStep | null;
  /** `agent` = the documents end up with an agent of the organization (fallback or manual-only flag), `automatic` otherwise. */
  reviewMode: 'automatic' | 'agent';
  /** How the app treats an unreadable MRZ: refuse (`strict`), warn and let the holder send anyway (`warn`), or ignore (`off`). */
  mrzPrecheck: 'strict' | 'warn' | 'off';
}

export type KycPhotoStep = 'front' | 'back' | 'selfie';

const PROVIDER_STEP: Record<string, KycPhotoStep> = {
  AWAITING_FRONT: 'front',
  FRONT_PROCESSING: 'front',
  AWAITING_BACK: 'back',
  BACK_PROCESSING: 'back',
  CROSS_VALIDATING: 'back',
  AWAITING_LIVE: 'selfie',
  LIVE_PROCESSING: 'selfie',
  FACE_MATCHING: 'selfie',
};

/**
 * What the classifier reads in a provider answer: its stable rejection code (`CROSS_VALIDATION_FAILED`...) and its
 * sentence. Never stored: only the mapped `KycFailureReason` is.
 */
function providerFailureText(remote: IdswyftStatusView): string | null {
  const text = [remote.assessment?.rejectionCode, remote.reason].filter((part): part is string => !!part).join(' ');
  return text === '' ? null : text;
}

/** A certificate type seen by the gate: its id and KYC policy. */
export interface KycGatedType {
  id: string;
  kyc: KycPolicy;
}

/** Maps the provider's free-text reason to a fixed internal value, so no document content is ever stored. */
export function classifyFailureReason(reason: string | null, hardRejected: boolean): KycFailureReason {
  const text = (reason ?? '').toLowerCase();
  // The provider's reason is a code (LIVENESS_FAILED, CROSS_VALIDATION_FAILED, ...), never personal data: name the cause
  // even for a hard rejection, so the holder is told what to fix. Only an unrecognised hard rejection stays "rejected".
  let classified: KycFailureReason = 'other';
  if (/liveness|spoof|deepfake|replay/.test(text)) classified = 'liveness_failed';
  else if (/expir/.test(text)) classified = 'document_expired';
  else if (/face|selfie|biometric/.test(text)) classified = 'selfie_mismatch';
  else if (/blur|unreadable|illegible|quality|ocr|glare|dark|resolution|barcode|mrz|cross_validation|back_|front_/.test(text)) classified = 'document_unreadable';
  if (classified === 'other' && hardRejected) return 'rejected';
  return classified;
}

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);
  private readonly lastRefresh = new Map<string, number>();
  private readonly precheckHits = new Map<string, number[]>();
  /** Fingerprint of the last assessment kept per dossier, so a 3 s status poll does not rewrite an identical encrypted blob. */
  private readonly lastAssessment = new Map<string, string>();

  constructor(
    @InjectRepository(KycVerification)
    private readonly verificationsRepository: Repository<KycVerification>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly idswyft: IdswyftHttpClientService,
    private readonly configService: ConfigService,
    private readonly engine: IdswyftEngineClientService,
    private readonly vault: KycDocumentVaultService,
  ) {}

  /** Idswyft is bypassed: an agent decides every dossier. Needs the document vault, else it cannot work at all. */
  private get manualOnly(): boolean {
    return this.configService.get<string>('kyc.providerMode', 'idswyft') === 'manual_only';
  }

  /** A provider failure sends the dossier to an agent. Only when copies can be kept, or the agent would have nothing to look at. */
  private get fallbackActive(): boolean {
    return this.configService.get<boolean>('kyc.fallbackManualReview', false) && this.vault.canStore;
  }

  private get mrzPrecheckMode(): 'strict' | 'warn' | 'off' {
    return this.configService.get<'strict' | 'warn' | 'off'>('kyc.mrzPrecheck', 'strict');
  }

  /** No provider call is made for this dossier any more: photos are only kept, then an agent decides. */
  private isDetached(verification: KycVerification): boolean {
    return verification.reviewOrigin === 'fallback' || verification.reviewOrigin === 'manual_only';
  }

  /** Whether the holder has at least one dossier read back as `verified` (never "the latest": a later failure does not revoke). */
  async hasVerifiedKyc(userId: string): Promise<boolean> {
    return this.verificationsRepository.exists({ where: { userId, status: KycStatus.VERIFIED } });
  }

  /**
   * Gate for the certificate flow: 403 `KYC_REQUIRED` when the type is enforced and the holder is not verified.
   * The server is the authority; the mobile app only mirrors it.
   */
  async assertVerifiedFor(userId: string, type: KycGatedType): Promise<void> {
    const enforced = isKycEnforced(type, {
      enforcement: this.configService.get<boolean>('kyc.enforcement', true),
      enforcedTypes: this.configService.get<string[]>('kyc.enforcedTypes', []),
    });
    if (!enforced) return;
    if (await this.hasVerifiedKyc(userId)) return;

    this.logger.warn(`[RESULT] kyc gate refused userId=${userId} certificateType=${type.id} reason=not_verified`);
    throw new ForbiddenException({
      statusCode: HttpStatus.FORBIDDEN,
      code: KYC_REQUIRED_CODE,
      message: 'Identity verification is required for this certificate. Complete it in the app first.',
    });
  }

  /**
   * Opens a verification session. Idempotent: an already verified or still active (pending / manual review)
   * dossier is returned as is, so a double tap never creates a second provider session (the partial unique
   * index decides a race). A new session counts against the daily cap.
   */
  async startSession(userId: string, documentType: KycDocumentType, issuingCountry?: string): Promise<KycStatusView> {
    this.logger.log(`[START] kyc startSession userId=${userId} documentType=${documentType} issuingCountry=${issuingCountry ?? '-'}`);
    await this.assertActiveAccount(userId);

    let current = await this.findBest(userId);
    if (current?.status === KycStatus.PENDING && Date.now() - current.createdAt.getTime() > STALE_PENDING_MS) {
      // Abandoned dossier: read it back once (a lost webhook may hide a verdict), then close it so the holder is
      // not stuck behind a session the provider no longer accepts.
      await this.refreshFromProvider(current).catch(() => undefined);
      if (current.status === KycStatus.PENDING) {
        current = await this.closeAs(current, KycStatus.FAILED, 'other');
      }
    }
    if (current && [KycStatus.VERIFIED, KycStatus.PENDING, KycStatus.MANUAL_REVIEW].includes(current.status)) {
      if (current.status === KycStatus.PENDING) {
        // Where did the session stop? Best effort: without it the app starts from the front photo.
        await this.refreshFromProvider(current).catch(() => undefined);
      }
      this.logger.log(`[STATE] kyc startSession reused sessionId=${current.id} status=${current.status}`);
      return this.toView(await this.withDetachedStep(current));
    }

    const maxPerDay = this.configService.get<number>('kyc.maxSessionsPerDay', 5);
    const recent = await this.verificationsRepository.count({
      where: { userId, createdAt: MoreThan(new Date(Date.now() - DAY_MS)) },
    });
    if (recent >= maxPerDay) {
      this.logger.warn(`[RESULT] kyc startSession refused userId=${userId} reason=daily_cap recent=${recent}`);
      throw new HttpException('Too many verification attempts today. Try again tomorrow.', HttpStatus.TOO_MANY_REQUESTS);
    }

    // Manual-only: there is no provider session. Without the vault the photos could not be kept for the agent.
    if (this.manualOnly && !this.vault.canStore) {
      this.logger.error('[RESULT] kyc startSession refused reason=manual_only_without_encryption_key');
      throw new ServiceUnavailableException('Manual identity verification is not configured. Try again later.');
    }
    // Our users.id is the provider-side user_id, so a webhook or status can always be tied back to the holder.
    const verificationId = this.manualOnly
      ? `${KYC_MANUAL_PROVIDER_ID_PREFIX}${randomUUID()}`
      : await this.callProvider(() => this.idswyft.initialize({ userId, documentType, issuingCountry }));
    try {
      const saved = await this.verificationsRepository.save(
        this.verificationsRepository.create({
          userId,
          provider: this.manualOnly ? 'manual' : KYC_PROVIDER_IDSWYFT,
          providerVerificationId: verificationId,
          status: KycStatus.PENDING,
          documentType,
          issuingCountry: issuingCountry ?? null,
          reviewOrigin: this.manualOnly ? 'manual_only' : null,
        }),
      );
      this.logger.log(`[STATE] kyc session opened sessionId=${saved.id} providerVerificationId=${verificationId}`);
      return this.toView(saved);
    } catch (error) {
      // Lost the race with a parallel call: the partial unique index allows one active dossier per holder.
      if (this.isUniqueViolation(error)) {
        const winner = await this.findBest(userId);
        if (winner) {
          this.logger.warn(`[RESULT] kyc startSession raced userId=${userId} keptSessionId=${winner.id}`);
          return this.toView(await this.withDetachedStep(winner));
        }
      }
      throw error;
    }
  }

  /** Sends one photo of the caller's own pending session to the provider; reads the verdict back after the selfie. */
  async uploadStep(
    userId: string,
    sessionId: string,
    step: IdswyftUploadStep,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<KycStatusView> {
    this.logger.log(`[START] kyc uploadStep sessionId=${sessionId} step=${step}`);
    await this.assertActiveAccount(userId);
    const verification = await this.findOwned(userId, sessionId);
    this.logger.log(`[ENTITY] kyc uploadStep providerVerificationId=${verification.providerVerificationId}`);

    if (verification.status !== KycStatus.PENDING) {
      throw new ConflictException(`This verification is ${verification.status}; it no longer accepts photos.`);
    }
    if (step === 'back' && !KYC_DOCUMENT_TYPES_WITH_BACK.includes(verification.documentType as KycDocumentType)) {
      throw new BadRequestException('This document type has no back side.');
    }

    // Atomic: N parallel uploads cannot slip past the cap. Counted before forwarding and never refunded.
    const counted = await this.verificationsRepository
      .createQueryBuilder()
      .update(KycVerification)
      .set({ attempts: () => 'attempts + 1' })
      .where('id = :id AND user_id = :userId AND status = :status AND attempts < :cap', {
        id: verification.id,
        userId,
        status: KycStatus.PENDING,
        cap: KYC_MAX_UPLOADS_PER_SESSION,
      })
      .execute();
    if (!counted.affected) {
      this.logger.warn(`[RESULT] kyc uploadStep refused sessionId=${verification.id} reason=cap_or_closed`);
      throw new HttpException('Too many photos sent for this verification. Start a new one.', HttpStatus.TOO_MANY_REQUESTS);
    }
    verification.attempts += 1;

    // A copy for the agent, kept BEFORE the provider sees the photo: if the provider then rejects it, the agent still has it.
    // A detached dossier lives on these copies alone, so a failure to keep one is an error; otherwise it is best effort.
    const detached = this.isDetached(verification);
    try {
      const kept = await this.vault.store(verification.id, step, file);
      // The write is conditional on the dossier still being `pending`: refused means it moved on (another request completed it).
      if (!kept && detached && this.vault.wanted) {
        throw new ConflictException(`This verification is no longer accepting photos.`);
      }
    } catch (error) {
      if (detached) throw error;
      this.logger.warn(`[RESULT] kyc uploadStep copy not kept sessionId=${verification.id} step=${step} reason=${(error as Error).name}`);
    }
    if (detached) {
      await this.completeIfPhotosReady(verification);
      this.logger.log(`[STATE] kyc uploadStep kept for agent sessionId=${verification.id} step=${step} status=${verification.status}`);
      return this.toView(await this.withDetachedStep(verification));
    }

    try {
      await this.callProvider(() => this.idswyft.upload(verification.providerVerificationId, step, file));
    } catch (error) {
      // The automatic check is out of reach or refused the photo: with the fallback on, an agent takes over.
      if (this.fallbackActive && this.isFallbackError(error)) {
        let reason: KycFailureReason = error instanceof BadRequestException ? 'document_unreadable' : 'other';
        // A refused photo or a closed session is the provider's verdict on what it read: keep that reading for the agent,
        // and name the real cause (e.g. FRONT_OCR_FAILED -> document_unreadable) instead of "other".
        if (error instanceof ConflictException || error instanceof BadRequestException) {
          reason = (await this.readClosedSession(verification)) ?? reason;
        }
        await this.detachToAgent(verification, reason);
        await this.completeIfPhotosReady(verification);
        return this.toView(await this.withDetachedStep(verification));
      }
      // 409 = the provider closed the session (hard rejection, wrong step). Record it, or the holder would be
      // stuck on a pending dossier that can never progress. A timeout means the photo may have arrived and the
      // provider may still be working: read the state back so `nextStep` is as accurate as it can be.
      if (error instanceof ConflictException || error instanceof GatewayTimeoutException) {
        await this.refreshFromProvider(verification).catch(() => undefined);
      }
      throw error;
    }

    if (step === 'selfie') {
      // The photo is accepted and counted: a provider outage now must not turn it into an error. The dossier stays
      // pending and the app's poll (or the webhook) finishes the job.
      await this.refreshFromProvider(verification).catch((error: unknown) =>
        this.logger.warn(`[RESULT] kyc post-selfie read-back failed sessionId=${verification.id} reason=${(error as Error).name}`),
      );
    }
    this.logger.log(`[STATE] kyc uploadStep done sessionId=${verification.id} step=${step} status=${verification.status}`);
    return this.toView(await this.withDetachedStep(verification));
  }

  /**
   * Closes the holder's own open session so a new one can be started (another document, another country). Nothing is
   * deleted at the provider: the dossier simply ends as `failed` (reason `other`) and counts in the daily cap. A dossier
   * that is no longer pending (verified, in review, already closed) is returned unchanged.
   */
  async cancelSession(userId: string, sessionId: string): Promise<KycStatusView> {
    this.logger.log(`[START] kyc cancelSession sessionId=${sessionId}`);
    const verification = await this.findOwned(userId, sessionId);
    if (verification.status !== KycStatus.PENDING) {
      this.logger.log(`[STATE] kyc cancelSession nothing to cancel sessionId=${verification.id} status=${verification.status}`);
      return this.toView(verification);
    }
    const closed = await this.closeAs(verification, KycStatus.FAILED, 'other');
    this.logger.log(`[STATE] kyc cancelSession done sessionId=${closed.id} status=${closed.status}`);
    return this.toView(closed);
  }

  /**
   * Quick check, BEFORE the upload, that a photo shows what the step expects (a document, or a face). Idswyft hard-rejects
   * a session on one unreadable front, which then costs one of the holder's daily sessions, so a photo of a wall is
   * stopped here instead. Never counts as an upload, never changes the dossier. If the check cannot run (engine off or
   * failing) the answer is `skipped` and the photo is sent as usual: the real gates stay in Idswyft.
   */
  async precheck(userId: string, sessionId: string, step: IdswyftUploadStep, file: { buffer: Buffer; mimetype: string }): Promise<KycPrecheckResult> {
    this.logger.log(`[START] kyc precheck sessionId=${sessionId} step=${step}`);
    await this.assertActiveAccount(userId);
    const verification = await this.findOwned(userId, sessionId);
    if (verification.status !== KycStatus.PENDING) {
      throw new ConflictException(`This verification is ${verification.status}; it no longer accepts photos.`);
    }
    if (step === 'back' && !KYC_DOCUMENT_TYPES_WITH_BACK.includes(verification.documentType as KycDocumentType)) {
      throw new BadRequestException('This document type has no back side.');
    }
    if (!this.engine.enabled) return 'skipped';
    // The app calls this in a loop while the holder aims the camera: bounded per session so it cannot flood the engine.
    this.assertPrecheckBudget(verification.id);

    try {
      let result: KycPrecheckResult;
      if (step === 'selfie') {
        result = (await this.engine.detectFace(file)) ? 'ok' : 'no_face';
      } else {
        const text = await this.engine.readText(file);
        result =
          step === 'front'
            ? looksLikeDocumentFront(text.rawText, text.detectedType, text.confidence)
              ? 'ok'
              : 'no_document'
            : backPrecheckVerdict(text.rawText, this.mrzPrecheckMode === 'off' ? null : text.mrz);
      }
      this.logger.log(`[RESULT] kyc precheck sessionId=${sessionId} step=${step} result=${result}`);
      return result;
    } catch (error) {
      this.logger.warn(`[RESULT] kyc precheck skipped sessionId=${sessionId} step=${step} reason=${(error as Error).name}`);
      return 'skipped';
    }
  }

  /** The caller's best dossier (verified first). A pending / in-review one is refreshed from the provider (webhook safety net). */
  async getStatus(userId: string): Promise<KycStatusView> {
    const current = await this.findBest(userId);
    if (!current) {
      return {
        status: 'not_started',
        sessionId: null,
        documentType: null,
        attempts: 0,
        verifiedAt: null,
        failureReason: null,
        canRestart: true,
        nextStep: null,
        reviewMode: this.reviewMode(),
        mrzPrecheck: this.mrzPrecheckMode,
      };
    }
    if (OPEN_STATUSES.includes(current.status) && this.shouldRefresh(current.id)) {
      try {
        await this.refreshFromProvider(current);
      } catch (error) {
        // A provider outage must not break the status screen: show what we last knew.
        this.logger.warn(`[RESULT] kyc getStatus refresh skipped sessionId=${current.id} reason=${(error as Error).name}`);
      }
    }
    return this.toView(await this.withDetachedStep(current));
  }

  /** At most `PRECHECK_MAX_PER_WINDOW` prechecks per session in a sliding window; beyond that, 429. */
  private assertPrecheckBudget(sessionId: string): void {
    const now = Date.now();
    const recent = (this.precheckHits.get(sessionId) ?? []).filter((at) => now - at < PRECHECK_WINDOW_MS);
    if (recent.length >= PRECHECK_MAX_PER_WINDOW) {
      this.logger.warn(`[RESULT] kyc precheck refused sessionId=${sessionId} reason=budget`);
      throw new HttpException('Too many photo checks. Wait a moment.', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    if (this.precheckHits.size > 1000) this.precheckHits.clear();
    this.precheckHits.set(sessionId, recent);
  }

  /** The app polls every few seconds: read the provider at most once per window and session, whatever the callers. */
  private shouldRefresh(sessionId: string): boolean {
    const now = Date.now();
    const last = this.lastRefresh.get(sessionId) ?? 0;
    if (now - last < REFRESH_MIN_INTERVAL_MS) return false;
    if (this.lastRefresh.size > 1000) this.lastRefresh.clear();
    this.lastRefresh.set(sessionId, now);
    return true;
  }

  /**
   * Reads the verification back from the provider and records the outcome. This is the only place a dossier
   * becomes `verified` ("the read is the proof"; a webhook only triggers it). Fail closed: anything but an
   * exact `verified` answer for OUR verification id leaves the row untouched, and the write is conditional on
   * the dossier still being open, so a `verified` dossier is write-once.
   */
  async refreshFromProvider(verification: KycVerification): Promise<KycVerification> {
    if (!OPEN_STATUSES.includes(verification.status)) return verification;
    // A detached dossier has no provider session to read back: an agent decides it.
    if (this.isDetached(verification)) return verification;

    this.logger.log(`[CALL] kyc refreshFromProvider sessionId=${verification.id}`);
    let remote: IdswyftStatusView;
    try {
      remote = await this.idswyft.getStatus(verification.providerVerificationId);
    } catch (error) {
      if (error instanceof IdswyftApiError && error.status === 404) {
        // The provider no longer knows this session: it can never progress, so stop polling it. With the fallback on an
        // agent takes over (the photos are kept here); otherwise close the dossier instead of retrying forever.
        this.logger.warn(`[RESULT] kyc refreshFromProvider provider session gone sessionId=${verification.id}`);
        if (this.fallbackActive) {
          await this.detachToAgent(verification, 'other');
          await this.completeIfPhotosReady(verification);
          return verification;
        }
        await this.closeAs(verification, KycStatus.FAILED, 'other');
        return verification;
      }
      // Never the "photo refused" wording of the upload path.
      if (error instanceof IdswyftApiError && error.status === null) {
        throw this.noAnswerError(error);
      }
      throw new BadGatewayException('The verification service failed. Try again later.');
    }
    // The URL already pins the id; the echo is a cross-check. A DIFFERENT id is refused; an absent one is tolerated
    // (the contract is documented but not pinned by a recorded sample) and logged apart from a mismatch.
    if (remote.verificationId === null) {
      this.logger.warn(`[RESULT] kyc refreshFromProvider answer carries no verification_id sessionId=${verification.id}`);
    } else if (remote.verificationId !== verification.providerVerificationId) {
      this.logger.error(`[RESULT] kyc refreshFromProvider id mismatch sessionId=${verification.id} — answer ignored`);
      throw new BadGatewayException('The verification service returned an unexpected answer.');
    }
    verification.providerStep = remote.status ? (PROVIDER_STEP[remote.status] ?? null) : null;

    let next: KycStatus = verification.status;
    let failureReason: KycFailureReason | null = null;
    if (remote.finalResult === 'verified') {
      next = KycStatus.VERIFIED;
    } else if (remote.finalResult === 'manual_review') {
      next = KycStatus.MANUAL_REVIEW;
    } else if (remote.finalResult === 'failed' || remote.status === 'HARD_REJECTED') {
      const hardRejected = remote.status === 'HARD_REJECTED';
      next = hardRejected ? KycStatus.REJECTED : KycStatus.FAILED;
      failureReason = classifyFailureReason(providerFailureText(remote), hardRejected);
      // Whatever the automatic check refused (unreadable or mismatching document, expiry, face, liveness, suspected
      // forgery, unexplained rejection), with the fallback on it is an AGENT who arbitrates, never the provider: the
      // holder goes through every step (front, back, selfie), the reading is kept for the agent, and only an agent
      // can validate or reject. The photos already stored are the evidence; `completeIfPhotosReady` waits for the rest.
      if (this.fallbackActive) {
        await this.keepAssessment(verification, remote.assessment);
        await this.detachToAgent(verification, failureReason);
        await this.completeIfPhotosReady(verification);
        return verification;
      }
    }

    // What the automatic check read, for the agent who may take over. Not for a dossier that ends without an agent
    // (verified, failed, rejected): nobody would look at it and the copies are deleted just below.
    if (next === KycStatus.PENDING || next === KycStatus.MANUAL_REVIEW) {
      await this.keepAssessment(verification, remote.assessment);
    }

    if (next !== verification.status) {
      const verifiedAt = next === KycStatus.VERIFIED ? new Date() : null;
      const reviewOrigin: KycReviewOrigin | null = next === KycStatus.MANUAL_REVIEW ? 'provider' : (verification.reviewOrigin ?? null);
      const written = await this.verificationsRepository.update(
        { id: verification.id, status: In(OPEN_STATUSES) },
        { status: next, failureReason, verifiedAt, reviewOrigin },
      );
      if (written.affected) {
        verification.status = next;
        verification.failureReason = failureReason;
        verification.verifiedAt = verifiedAt;
        verification.reviewOrigin = reviewOrigin;
        // Final outcome without an agent (verified, failed, rejected): no one will look at the photos, so no copy is kept.
        if (next !== KycStatus.MANUAL_REVIEW) await this.vault.deleteFor(verification.id).catch(() => undefined);
        // Verified by the provider alone: keep the reduced, PII-free audit so an agent can look back at how it decided.
        if (next === KycStatus.VERIFIED) await this.keepAutoAudit(verification, remote.autoAudit);
      } else {
        // Another request closed it first: trust the stored row, never overwrite it.
        const stored = await this.verificationsRepository.findOne({ where: { id: verification.id } });
        if (stored) Object.assign(verification, stored);
      }
    }
    this.logger.log(`[RESULT] kyc refreshFromProvider sessionId=${verification.id} status=${verification.status}`);
    return verification;
  }

  /**
   * Keeps the encrypted assessment of the automatic check. Best effort: a failure here never changes the verdict or the
   * status. Logs counts only (see `describeAssessment`), never a value read on the document.
   */
  private async keepAssessment(verification: KycVerification, assessment: KycAssessment | null | undefined): Promise<void> {
    if (!assessment) return;
    const digest = assessmentDigest(assessment);
    if (this.lastAssessment.get(verification.id) === digest) return;
    try {
      if (await this.vault.storeAssessment(verification.id, assessment)) {
        if (this.lastAssessment.size > 1000) this.lastAssessment.clear();
        this.lastAssessment.set(verification.id, digest);
      }
    } catch (error) {
      this.logger.warn(`[RESULT] kyc assessment not kept sessionId=${verification.id} reason=${(error as Error).name}`);
    }
  }

  /**
   * Keeps the reduced audit of a dossier the provider just verified (after the photos and the OCR assessment were deleted).
   * Best effort: a failure never changes the verdict. Logs flags and counts only (see `describeAutoAudit`).
   */
  private async keepAutoAudit(verification: KycVerification, audit: KycAutoAudit | null | undefined): Promise<void> {
    if (!audit) return;
    try {
      if (!(await this.vault.storeAutoAudit(verification.id, audit))) {
        this.logger.warn(`[RESULT] kyc auto audit not kept sessionId=${verification.id} reason=${this.vault.canStore ? 'not_verified' : 'no_encryption_key'}`);
      }
    } catch (error) {
      this.logger.warn(`[RESULT] kyc auto audit not kept sessionId=${verification.id} reason=${(error as Error).name}`);
    }
  }

  /**
   * After a refused photo or a closed session: reads the provider's state once to keep its reading for the agent and to
   * learn WHY it stopped. Returns the mapped reason (any of them: with the fallback on an agent arbitrates all of
   * them), or `null` when the read gives nothing usable. Best effort and fail-closed on the id: any problem leaves the
   * caller's default reason.
   */
  private async readClosedSession(verification: KycVerification): Promise<KycFailureReason | null> {
    try {
      this.logger.log(`[CALL] kyc readClosedSession sessionId=${verification.id}`);
      const remote = await this.idswyft.getStatus(verification.providerVerificationId);
      if (remote.verificationId !== null && remote.verificationId !== verification.providerVerificationId) return null;
      if (remote.finalResult === 'verified') return null;
      await this.keepAssessment(verification, remote.assessment);
      return classifyFailureReason(providerFailureText(remote), remote.status === 'HARD_REJECTED');
    } catch (error) {
      this.logger.warn(`[RESULT] kyc readClosedSession skipped sessionId=${verification.id} reason=${(error as Error).name}`);
      return null;
    }
  }

  /** Whether a provider failure is one the fallback may absorb: no answer, a refused photo or a closed session; not a rate limit. */
  private isFallbackError(error: unknown): boolean {
    return (
      error instanceof ConflictException ||
      error instanceof GatewayTimeoutException ||
      error instanceof ServiceUnavailableException ||
      error instanceof BadGatewayException ||
      error instanceof BadRequestException
    );
  }

  /** Cuts the dossier off from the provider; it stays `pending` until the photos an agent needs are all kept. */
  private async detachToAgent(verification: KycVerification, reason: KycFailureReason): Promise<void> {
    const written = await this.verificationsRepository.update(
      { id: verification.id, status: KycStatus.PENDING },
      { reviewOrigin: 'fallback', failureReason: reason },
    );
    if (written.affected) {
      verification.reviewOrigin = 'fallback';
      verification.failureReason = reason;
      this.logger.warn(`[STATE] kyc dossier detached for agent review sessionId=${verification.id} reason=${reason}`);
    }
  }

  /** A detached `pending` dossier whose photos are all kept moves to `manual_review`; the write is conditional on `pending`. */
  private async completeIfPhotosReady(verification: KycVerification): Promise<void> {
    if (verification.status !== KycStatus.PENDING || !this.isDetached(verification)) return;
    const kept = await this.vault.kindsFor(verification.id);
    if (!kycRequiredKinds(verification.documentType).every((kind) => kept.includes(kind))) return;
    const written = await this.verificationsRepository.update({ id: verification.id, status: KycStatus.PENDING }, { status: KycStatus.MANUAL_REVIEW });
    if (written.affected) {
      verification.status = KycStatus.MANUAL_REVIEW;
      this.logger.log(`[STATE] kyc dossier waiting for an agent sessionId=${verification.id} origin=${verification.reviewOrigin}`);
    }
  }

  /** For a detached `pending` dossier the next photo comes from what is kept, not from the provider. */
  private async withDetachedStep(verification: KycVerification): Promise<KycVerification> {
    if (verification.status !== KycStatus.PENDING || !this.isDetached(verification)) return verification;
    const kept = await this.vault.kindsFor(verification.id);
    verification.providerStep = kycRequiredKinds(verification.documentType).find((kind) => !kept.includes(kind)) ?? null;
    return verification;
  }

  private reviewMode(): 'automatic' | 'agent' {
    return this.manualOnly || this.fallbackActive ? 'agent' : 'automatic';
  }

  findByProviderVerificationId(providerVerificationId: string): Promise<KycVerification | null> {
    return this.verificationsRepository.findOne({ where: { providerVerificationId } });
  }

  /** The dossier that matters: a verified one if any, else the newest. */
  private async findBest(userId: string): Promise<KycVerification | null> {
    const verified = await this.verificationsRepository.findOne({
      where: { userId, status: KycStatus.VERIFIED },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return verified ?? this.verificationsRepository.findOne({ where: { userId }, order: { createdAt: 'DESC', id: 'DESC' } });
  }

  /** The holder's own dossier, else 404 — a session of another user is indistinguishable from a missing one. */
  private async findOwned(userId: string, sessionId: string): Promise<KycVerification> {
    const verification = await this.verificationsRepository.findOne({ where: { id: sessionId, userId } });
    if (!verification) {
      throw new NotFoundException('Verification not found');
    }
    return verification;
  }

  /** The JWT is trusted without a DB lookup, so a suspended account must be refused here. */
  private async assertActiveAccount(userId: string): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      this.logger.warn(`[RESULT] kyc refused: account not active userId=${userId}`);
      throw new ForbiddenException('Your account is not active');
    }
  }

  private async closeAs(verification: KycVerification, status: KycStatus, failureReason: KycFailureReason): Promise<KycVerification> {
    const written = await this.verificationsRepository.update({ id: verification.id, status: In(OPEN_STATUSES) }, { status, failureReason });
    if (written.affected) {
      verification.status = status;
      verification.failureReason = failureReason;
      await this.vault.deleteFor(verification.id).catch(() => undefined);
      this.logger.log(`[STATE] kyc dossier closed sessionId=${verification.id} status=${status} reason=${failureReason}`);
    }
    return verification;
  }

  private toView(verification: KycVerification): KycStatusView {
    const reason = verification.failureReason;
    return {
      status: verification.status,
      sessionId: verification.id,
      documentType: verification.documentType,
      attempts: verification.attempts,
      verifiedAt: verification.verifiedAt,
      failureReason: reason !== null && (KYC_FAILURE_REASONS as readonly string[]).includes(reason) ? reason : null,
      canRestart: [KycStatus.FAILED, KycStatus.REJECTED].includes(verification.status),
      nextStep: verification.status === KycStatus.PENDING ? (verification.providerStep ?? null) : null,
      reviewMode: this.reviewMode(),
      mrzPrecheck: this.mrzPrecheckMode,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof QueryFailedError && (error.driverError as { code?: string } | undefined)?.code === PG_UNIQUE_VIOLATION;
  }

  /** Maps a provider failure to an HTTP error the holder can act on, without echoing the provider's body. */
  private async callProvider<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof IdswyftApiError)) throw error;
      if (error.status === 409) {
        throw new ConflictException('This verification cannot take that step. Start a new verification.');
      }
      if (error.status === 429) {
        throw new HttpException('The verification service is busy. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
      }
      if (error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 403) {
        throw new BadRequestException('The photo was refused. Retake it in good light, with the whole document in frame.');
      }
      if (error.status === null) {
        throw this.noAnswerError(error);
      }
      throw new BadGatewayException('The verification service failed. Try again later.');
    }
  }

  /**
   * No HTTP answer from the provider. A timeout is NOT "unreachable": Idswyft may still be analysing the photo (and may
   * have received it), so it gets its own status and code; the app then reads the progress back instead of failing.
   */
  private noAnswerError(error: IdswyftApiError): HttpException {
    if (error.kind === 'timeout') {
      return new GatewayTimeoutException({
        statusCode: HttpStatus.GATEWAY_TIMEOUT,
        code: KYC_PROVIDER_TIMEOUT_CODE,
        message: 'The verification took longer than expected. Your photo may have been received: check your progress, then retry if needed.',
      });
    }
    return new ServiceUnavailableException({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      code: KYC_PROVIDER_UNREACHABLE_CODE,
      message: 'The verification service is unreachable. Try again later.',
    });
  }
}
