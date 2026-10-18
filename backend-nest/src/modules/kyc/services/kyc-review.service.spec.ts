import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListKycReviewsQueryDto } from '../dto/kyc-review.dto';
import { KycStatus } from '../kyc.constants';
import { KycReviewService } from './kyc-review.service';

const AGENT = 'agent-1';
const HOLDER = 'holder-1';

function makeDossier(over: Record<string, unknown> = {}) {
  return {
    id: '11111111-aaaa-bbbb-cccc-222222222222',
    userId: HOLDER,
    status: KycStatus.MANUAL_REVIEW,
    reviewOrigin: 'fallback',
    documentType: 'national_id',
    issuingCountry: 'SN',
    failureReason: 'document_unreadable',
    attempts: 3,
    createdAt: new Date('2026-10-17T10:00:00Z'),
    user: { displayName: 'Awa Diallo', email: 'awa@example.com' },
    reviewer: null,
    reviewedAt: null,
    reviewNote: null,
    ...over,
  };
}

describe('KycReviewService', () => {
  let repo: { findAndCount: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let usersRepo: { findOne: jest.Mock };
  let vault: { kindsFor: jest.Mock; read: jest.Mock; deleteFor: jest.Mock; purgeExpired: jest.Mock; readAssessment: jest.Mock; readAutoAudit: jest.Mock };
  let accessLog: { record: jest.Mock };
  let service: KycReviewService;

  beforeEach(() => {
    repo = {
      findAndCount: jest.fn().mockResolvedValue([[makeDossier()], 1]),
      findOne: jest.fn().mockResolvedValue(makeDossier()),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    usersRepo = { findOne: jest.fn().mockResolvedValue({ id: AGENT, organizationId: 'org-1', accountStatus: 'active' }) };
    vault = {
      kindsFor: jest.fn().mockResolvedValue(['front', 'back', 'selfie']),
      read: jest.fn().mockResolvedValue({ buffer: Buffer.from([1, 2, 3]), mimetype: 'image/jpeg' }),
      deleteFor: jest.fn().mockResolvedValue(undefined),
      purgeExpired: jest.fn().mockResolvedValue(0),
      readAssessment: jest.fn().mockResolvedValue(null),
      readAutoAudit: jest.fn().mockResolvedValue(null),
    };
    accessLog = { record: jest.fn().mockResolvedValue({}) };
    service = new KycReviewService(repo as never, usersRepo as never, vault as never, accessLog as never);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('list', () => {
    it('lists the dossiers waiting for an agent, oldest first, with the kept sides', async () => {
      const result = await service.list(AGENT, { limit: 20, offset: 0 });

      const options = repo.findAndCount.mock.calls[0][0] as { where: { status: string }; order: { createdAt: string } };
      expect(options.where.status).toBe(KycStatus.MANUAL_REVIEW);
      expect(options.order.createdAt).toBe('ASC');
      expect(result).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect(result.items[0]).toMatchObject({
        reference: 'KYC-11111111',
        holderName: 'Awa Diallo',
        origin: 'fallback',
        documentType: "Carte d'identité",
        availableDocuments: ['front', 'back', 'selfie'],
      });
    });

    it('computes the page from the offset and purges expired copies first', async () => {
      const result = await service.list(AGENT, { limit: 20, offset: 40 });
      expect(result.page).toBe(3);
      expect(vault.purgeExpired).toHaveBeenCalled();
    });

    it('lists the dossiers to review and the rejected ones only when an agent was involved (review_origin set)', async () => {
      await service.list(AGENT, { limit: 20, offset: 0, status: 'rejected' });
      const where = (repo.findAndCount.mock.calls[0][0] as { where: Record<string, unknown> }).where;
      expect(where['status']).toBe('rejected');
      expect(where['reviewOrigin']).toBeDefined();
    });

    describe('audit of the automatic verifications', () => {
      const autoRow = () => makeDossier({ status: KycStatus.VERIFIED, reviewOrigin: null, failureReason: null, verifiedAt: new Date('2026-10-18T10:00:00Z') });
      const optionsOf = (call = 0) => repo.findAndCount.mock.calls[call][0] as { where: unknown; order: Record<string, string>; take: number; skip: number };

      it('lists every verified dossier under "Identité validée", the ones the provider verified alone included (no origin filter)', async () => {
        repo.findAndCount.mockResolvedValue([[autoRow()], 1]);
        const result = await service.list(AGENT, { limit: 20, offset: 0, status: 'verified' });

        expect(optionsOf().where).toEqual({ status: 'verified' });
        expect(result.items[0]).toMatchObject({ origin: 'auto', status: 'verified' });
        expect(result.items[0].verifiedAt).toEqual(new Date('2026-10-18T10:00:00Z'));
      });

      it('shows the origin of a verified dossier an agent decided as it was, not "auto"', async () => {
        repo.findAndCount.mockResolvedValue([[makeDossier({ status: KycStatus.VERIFIED, reviewOrigin: 'fallback' })], 1]);
        const result = await service.list(AGENT, { limit: 20, offset: 0, status: 'verified' });
        expect(result.items[0].origin).toBe('fallback');
      });

      it('filters on the origin "auto" as: verified and review_origin NULL', async () => {
        await service.list(AGENT, { limit: 20, offset: 0, status: 'verified', origin: 'auto' });
        const where = optionsOf().where as Record<string, unknown>;
        expect(where['status']).toBe('verified');
        expect(JSON.stringify(where['reviewOrigin'])).toContain('isNull');
      });

      it('answers an empty page, without a query, for "auto" among the dossiers to review', async () => {
        const result = await service.list(AGENT, { limit: 20, offset: 40, status: 'manual_review', origin: 'auto' });
        expect(result).toEqual({ items: [], total: 0, page: 3, pageSize: 20 });
        expect(repo.findAndCount).not.toHaveBeenCalled();
      });

      it('"all" lists the three states: to review and rejected (agent involved) plus every verified one, newest first, paginated', async () => {
        await service.list(AGENT, { limit: 10, offset: 20, status: 'all' });

        const options = optionsOf();
        expect(options.order).toEqual({ createdAt: 'DESC', id: 'DESC' });
        expect([options.take, options.skip]).toEqual([10, 20]);
        const [involved, verified] = options.where as Array<Record<string, unknown>>;
        expect(JSON.stringify(involved['status'])).toContain('manual_review');
        expect(JSON.stringify(involved['status'])).toContain('rejected');
        expect(JSON.stringify(involved['status'])).not.toContain('verified');
        expect(involved['reviewOrigin']).toBeDefined();
        expect(verified).toEqual({ status: 'verified' });
      });

      it('"all" with an origin keeps that origin on the three states; "auto" is verified-only', async () => {
        await service.list(AGENT, { limit: 20, offset: 0, status: 'all', origin: 'fallback' });
        const first = optionsOf(0).where as Record<string, unknown>;
        expect(first['reviewOrigin']).toBe('fallback');
        expect(JSON.stringify(first['status'])).toContain('verified');

        await service.list(AGENT, { limit: 20, offset: 0, status: 'all', origin: 'auto' });
        const second = optionsOf(1).where as Record<string, unknown>;
        expect(second['status']).toBe('verified');
      });

      it('keeps the work queue oldest first, and the other views newest first', async () => {
        await service.list(AGENT, { limit: 20, offset: 0 });
        await service.list(AGENT, { limit: 20, offset: 0, status: 'verified' });
        await service.list(AGENT, { limit: 20, offset: 0, status: 'rejected' });
        expect(optionsOf(0).order['createdAt']).toBe('ASC');
        expect(optionsOf(1).order['createdAt']).toBe('DESC');
        expect(optionsOf(2).order['createdAt']).toBe('DESC');
      });

      it('keeps the role and organization scoping for the new views', async () => {
        usersRepo.findOne.mockResolvedValue({ id: AGENT, organizationId: null, accountStatus: 'active' });
        await expect(service.list(AGENT, { limit: 20, offset: 0, status: 'all' })).rejects.toBeInstanceOf(ForbiddenException);
        await expect(service.list(AGENT, { limit: 20, offset: 0, status: 'verified', origin: 'auto' })).rejects.toBeInstanceOf(ForbiddenException);
        expect(repo.findAndCount).not.toHaveBeenCalled();
      });

      it('does not decrypt anything in the list (no audit blob per row)', async () => {
        repo.findAndCount.mockResolvedValue([[autoRow(), autoRow()], 2]);
        const result = await service.list(AGENT, { limit: 20, offset: 0, status: 'all' });
        expect(vault.readAutoAudit).not.toHaveBeenCalled();
        expect(result.items[0]).not.toHaveProperty('autoAudit');
      });

      describe('detail', () => {
        const audit = {
          version: 1,
          readAt: '2026-10-18T10:00:00.000Z',
          providerVerdict: 'verified',
          isSandbox: true,
          faceMatch: { score: 0.905, threshold: 0.55, passed: true },
          liveness: { score: 0.91, threshold: null, passed: true },
          crossValidation: { verdict: 'PASS', passed: null, score: 0.88, checks: [{ name: 'date_of_birth', passed: true, score: 1 }] },
          documentExpired: false,
        };

        it('opens an automatically verified dossier read-only, with the reduced audit, and audits the opening with its state only', async () => {
          repo.findOne.mockResolvedValue(autoRow());
          vault.readAutoAudit.mockResolvedValue(audit);
          vault.kindsFor.mockResolvedValue([]);

          const view = await service.get(AGENT, 'kyc-1');

          expect(view).toMatchObject({ origin: 'auto', status: 'verified', availableDocuments: [], autoAudit: { state: 'available', audit } });
          expect(view).not.toHaveProperty('assessment');
          expect(vault.readAssessment).not.toHaveBeenCalled();
          expect(accessLog.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { holderUserId: HOLDER, autoAudit: 'available' } }));
          expect(JSON.stringify(accessLog.record.mock.calls)).not.toContain('0.905');
        });

        it('says "unavailable" for an older dossier or one past its retention, not an empty panel', async () => {
          repo.findOne.mockResolvedValue(autoRow());
          const view = await service.get(AGENT, 'kyc-1');
          expect(view.autoAudit).toEqual({ state: 'unavailable', audit: null });
        });

        it('carries no document data at all: no OCR assessment, no photo served, nothing to decide', async () => {
          repo.findOne.mockResolvedValue(autoRow());
          vault.readAutoAudit.mockResolvedValue(audit);
          const view = await service.get(AGENT, 'kyc-1');
          expect(JSON.stringify(view)).not.toMatch(/ocr|full_name|date_of_birth_value/);
          await expect(service.getDocument(AGENT, 'kyc-1', 'front')).rejects.toBeInstanceOf(NotFoundException);
          await expect(service.decide(AGENT, 'kyc-1', 'reject', 'Je veux rejeter un dossier déjà validé.')).rejects.toBeInstanceOf(ConflictException);
          expect(repo.update).not.toHaveBeenCalled();
        });

        it('reads the dossier by id for a verified row whatever its origin, else only when an agent was involved', async () => {
          repo.findOne.mockResolvedValue(autoRow());
          await service.get(AGENT, 'kyc-1');
          const where = (repo.findOne.mock.calls[0][0] as { where: Array<Record<string, unknown>> }).where;
          expect(where).toHaveLength(2);
          expect(where[1]).toMatchObject({ id: 'kyc-1', status: 'verified' });
          expect(where[0]['reviewOrigin']).toBeDefined();
        });

        it('does not read the audit of a dossier an agent decided', async () => {
          repo.findOne.mockResolvedValue(makeDossier({ status: KycStatus.VERIFIED, reviewOrigin: 'fallback' }));
          const view = await service.get(AGENT, 'kyc-1');
          expect(view).not.toHaveProperty('autoAudit');
          expect(vault.readAutoAudit).not.toHaveBeenCalled();
        });

        it('is refused to anyone who is not active staff, before any decryption', async () => {
          usersRepo.findOne.mockResolvedValue({ id: AGENT, organizationId: 'org-1', accountStatus: 'suspended' });
          await expect(service.get(AGENT, 'kyc-1')).rejects.toBeInstanceOf(ForbiddenException);
          expect(vault.readAutoAudit).not.toHaveBeenCalled();
        });
      });
    });

    describe('query validation', () => {
      const validate = (plain: Record<string, unknown>) => validateSync(plainToInstance(ListKycReviewsQueryDto, plain), { whitelist: true, forbidNonWhitelisted: true });

      it('accepts every state, "all" and the origin "auto"', () => {
        for (const status of ['manual_review', 'verified', 'rejected', 'all']) expect(validate({ status })).toHaveLength(0);
        expect(validate({ status: 'verified', origin: 'auto' })).toHaveLength(0);
        expect(validate({})).toHaveLength(0);
      });

      it('refuses an unknown state, an unknown origin and any other key (never a client-chosen holder)', () => {
        expect(validate({ status: 'pending' })).not.toHaveLength(0);
        expect(validate({ status: 'ALL' })).not.toHaveLength(0);
        expect(validate({ origin: 'something_else' })).not.toHaveLength(0);
        expect(validate({ userId: 'someone' })).not.toHaveLength(0);
      });

      it('leaves the status undefined when omitted, so the default view stays the work queue', () => {
        expect(plainToInstance(ListKycReviewsQueryDto, {}).status).toBeUndefined();
      });
    });

    it('refuses an account that belongs to no organization', async () => {
      usersRepo.findOne.mockResolvedValue({ id: AGENT, organizationId: null, accountStatus: 'active' });
      await expect(service.list(AGENT, { limit: 20, offset: 0 })).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.findAndCount).not.toHaveBeenCalled();
    });

    it('refuses a suspended agent even though the token still carries the role', async () => {
      usersRepo.findOne.mockResolvedValue({ id: AGENT, organizationId: 'org-1', accountStatus: 'suspended' });
      await expect(service.list(AGENT, { limit: 20, offset: 0 })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.getDocument(AGENT, 'kyc-1', 'front')).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.findAndCount).not.toHaveBeenCalled();
    });
  });

  describe('get and getDocument', () => {
    it('answers 404 for a dossier that never went through review', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.get(AGENT, 'x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('audits the read of a document: who looked at whose photo, ids only', async () => {
      const document = await service.getDocument(AGENT, 'kyc-1', 'back');

      expect(document.mimetype).toBe('image/jpeg');
      expect(accessLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: AGENT, resourceType: 'kyc_verification', metadata: { holderUserId: HOLDER, document: 'back' } }),
      );
    });

    it('serves no photo once the dossier has been decided', async () => {
      repo.findOne.mockResolvedValue(makeDossier({ status: KycStatus.VERIFIED }));
      await expect(service.getDocument(AGENT, 'kyc-1', 'front')).rejects.toBeInstanceOf(NotFoundException);
      expect(vault.read).not.toHaveBeenCalled();
    });

    it('answers 404 when the copy is gone (expired or deleted), without an audit entry', async () => {
      vault.read.mockResolvedValue(null);
      await expect(service.getDocument(AGENT, 'kyc-1', 'front')).rejects.toBeInstanceOf(NotFoundException);
      expect(accessLog.record).not.toHaveBeenCalled();
    });
  });

  describe('assessment of the automatic check', () => {
    const readings = {
      version: 1,
      readAt: '2026-10-18T09:00:00.000Z',
      providerStep: 'COMPLETE',
      finalResult: 'manual_review',
      rejectionCode: null,
      rejectionDetail: null,
      ocr: { fields: [{ key: 'full_name', value: 'Awa Diallo', confidence: 0.9 }], confidence: 0.8 },
      crossValidation: null,
      faceMatch: { score: 0.87, passed: true, verdict: null },
      liveness: null,
      riskScore: 0.2,
    };

    it('gives the agent what the automatic check read, on the detail route', async () => {
      vault.readAssessment.mockResolvedValue(readings);
      const view = await service.get(AGENT, 'kyc-1');
      expect(view.assessment).toEqual({ state: 'available', assessment: readings });
    });

    it('says "no data" when the provider answered without reading anything (rejection code only)', async () => {
      const refused = { ...readings, ocr: null, faceMatch: null, riskScore: null, rejectionCode: 'FRONT_OCR_FAILED', finalResult: 'failed' };
      vault.readAssessment.mockResolvedValue(refused);
      const view = await service.get(AGENT, 'kyc-1');
      expect(view.assessment).toEqual({ state: 'no_data', assessment: refused });
    });

    it('says "unavailable" when nothing was kept (provider outage, expired, key rotated): an explicit state, not an empty form', async () => {
      vault.readAssessment.mockResolvedValue(null);
      const view = await service.get(AGENT, 'kyc-1');
      expect(view.assessment).toEqual({ state: 'unavailable', assessment: null });
    });

    it('says "not run" for a manual-only dossier, without reading the vault', async () => {
      repo.findOne.mockResolvedValue(makeDossier({ reviewOrigin: 'manual_only', failureReason: null }));
      const view = await service.get(AGENT, 'kyc-1');
      expect(view.assessment).toEqual({ state: 'not_run', assessment: null });
      expect(vault.readAssessment).not.toHaveBeenCalled();
    });

    it('is not in the list (no decryption of N blobs) and not for a dossier already decided', async () => {
      vault.readAssessment.mockResolvedValue(readings);
      const list = await service.list(AGENT, { limit: 20, offset: 0 });
      expect(list.items[0]).not.toHaveProperty('assessment');
      repo.findOne.mockResolvedValue(makeDossier({ status: KycStatus.VERIFIED }));
      const decided = await service.get(AGENT, 'kyc-1');
      expect(decided).not.toHaveProperty('assessment');
      expect(vault.readAssessment).not.toHaveBeenCalled();
    });

    it('is refused to anyone who is not active staff of an organization, before any decryption', async () => {
      usersRepo.findOne.mockResolvedValue({ id: AGENT, organizationId: null, accountStatus: 'active' });
      await expect(service.get(AGENT, 'kyc-1')).rejects.toBeInstanceOf(ForbiddenException);
      usersRepo.findOne.mockResolvedValue({ id: AGENT, organizationId: 'org-1', accountStatus: 'suspended' });
      await expect(service.get(AGENT, 'kyc-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(vault.readAssessment).not.toHaveBeenCalled();
    });

    it('audits the opening with the assessment state only, never its content', async () => {
      vault.readAssessment.mockResolvedValue(readings);
      await service.get(AGENT, 'kyc-1');
      expect(accessLog.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { holderUserId: HOLDER, assessment: 'available' } }));
      expect(JSON.stringify(accessLog.record.mock.calls)).not.toContain('Awa Diallo');
    });

    it('is deleted with the photos at the decision, after the audit entry', async () => {
      await service.decide(AGENT, 'kyc-1', 'reject', 'Selfie sans rapport avec la pièce.');
      // `deleteFor` removes every row of the dossier, the assessment included (same table).
      expect(vault.deleteFor).toHaveBeenCalledWith('11111111-aaaa-bbbb-cccc-222222222222');
    });
  });

  describe('decide', () => {
    it('refuses a blind approval: every photo must be there, a rejection stays possible', async () => {
      vault.kindsFor.mockResolvedValue(['front']);
      await expect(service.decide(AGENT, 'kyc-1', 'approve', 'Je valide sans avoir vu les photos.')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.update).not.toHaveBeenCalled();

      await expect(service.decide(AGENT, 'kyc-1', 'reject', 'Photos manquantes, à refaire.')).resolves.toMatchObject({ status: KycStatus.REJECTED });
    });

    it('approves: verified, with the agent, the note and the date; deletes the copies; audits', async () => {
      const result = await service.decide(AGENT, 'kyc-1', 'approve', '  Concordance nom et selfie.  ');

      expect(result.status).toBe(KycStatus.VERIFIED);
      const [where, values] = repo.update.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
      expect(where).toMatchObject({ status: KycStatus.MANUAL_REVIEW });
      expect(values).toMatchObject({ status: KycStatus.VERIFIED, reviewedBy: AGENT, reviewNote: 'Concordance nom et selfie.', failureReason: null });
      expect(values['verifiedAt']).toBeInstanceOf(Date);
      expect(vault.deleteFor).toHaveBeenCalled();
      expect(accessLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'review', metadata: { holderUserId: HOLDER, decision: 'approve' } }));
      // The decision is on record before the photos are deleted.
      expect(accessLog.record.mock.invocationCallOrder[0]).toBeLessThan(vault.deleteFor.mock.invocationCallOrder[0]);
    });

    it('rejects: rejected with the fixed reason and no verification date', async () => {
      const result = await service.decide(AGENT, 'kyc-1', 'reject', 'Selfie sans rapport avec la pièce.');
      expect(result.status).toBe(KycStatus.REJECTED);
      expect(repo.update.mock.calls[0][1]).toMatchObject({ status: KycStatus.REJECTED, failureReason: 'rejected', verifiedAt: null });
    });

    it('refuses to let an agent decide their own identity verification', async () => {
      repo.findOne.mockResolvedValue(makeDossier({ userId: AGENT }));
      await expect(service.decide(AGENT, 'kyc-1', 'approve', 'Je me valide moi-même.')).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
      expect(accessLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'invalid', metadata: expect.objectContaining({ refused: 'own_dossier' }) }),
      );
    });

    it('answers 409 when the dossier is not waiting for an agent any more', async () => {
      repo.findOne.mockResolvedValue(makeDossier({ status: KycStatus.VERIFIED }));
      await expect(service.decide(AGENT, 'kyc-1', 'approve', 'Déjà traité par un collègue.')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('answers 409, deletes nothing and audits nothing when another agent wins the race', async () => {
      repo.update.mockResolvedValue({ affected: 0 });
      await expect(service.decide(AGENT, 'kyc-1', 'approve', 'Course entre deux agents.')).rejects.toBeInstanceOf(ConflictException);
      expect(vault.deleteFor).not.toHaveBeenCalled();
      expect(accessLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'invalid', metadata: expect.objectContaining({ refused: 'already_reviewed' }) }),
      );
    });

    it('answers 404 for a dossier that was never sent to review', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.decide(AGENT, 'kyc-1', 'approve', 'Dossier inconnu du circuit.')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
