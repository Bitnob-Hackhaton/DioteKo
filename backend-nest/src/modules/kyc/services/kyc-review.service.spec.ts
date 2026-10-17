import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
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
  let vault: { kindsFor: jest.Mock; read: jest.Mock; deleteFor: jest.Mock; purgeExpired: jest.Mock };
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

    it('only lists dossiers an agent was involved in when asked for history', async () => {
      await service.list(AGENT, { limit: 20, offset: 0, status: 'verified' });
      const where = (repo.findAndCount.mock.calls[0][0] as { where: Record<string, unknown> }).where;
      expect(where['status']).toBe('verified');
      expect(where['reviewOrigin']).toBeDefined();
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
