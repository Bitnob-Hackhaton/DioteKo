import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { KycAssessment } from '../kyc-assessment.util';
import { KycStatus } from '../kyc.constants';
import { IdswyftApiError } from './idswyft-http-client.service';
import { classifyFailureReason, KYC_MAX_UPLOADS_PER_SESSION, KycService } from './kyc.service';

const USER = 'user-1';
const PROVIDER_ID = 'prov-1';

/** What the automatic check read (personal data: it must never reach a log or a holder-facing view). */
function makeAssessment(over: Partial<KycAssessment> = {}): KycAssessment {
  return {
    version: 1,
    readAt: '2026-10-18T09:00:00.000Z',
    providerStep: 'HARD_REJECTED',
    finalResult: 'failed',
    rejectionCode: 'FRONT_OCR_FAILED',
    rejectionDetail: 'No required OCR fields could be read from the document',
    ocr: { fields: [{ key: 'full_name', value: 'Awa Diallo', confidence: 0.4 }], confidence: 0.4 },
    crossValidation: null,
    faceMatch: null,
    liveness: null,
    riskScore: null,
    ...over,
  };
}

function makeVerification(over: Record<string, unknown> = {}) {
  return {
    id: 'kyc-1',
    userId: USER,
    providerVerificationId: PROVIDER_ID,
    status: KycStatus.PENDING,
    documentType: 'national_id',
    attempts: 0,
    verifiedAt: null,
    failureReason: null,
    createdAt: new Date(),
    ...over,
  };
}

describe('KycService', () => {
  let repo: Record<string, jest.Mock>;
  let queryBuilder: { update: jest.Mock; set: jest.Mock; where: jest.Mock; execute: jest.Mock };
  let usersRepo: { findOne: jest.Mock };
  let idswyft: { initialize: jest.Mock; upload: jest.Mock; getStatus: jest.Mock };
  let engine: { enabled: boolean; readText: jest.Mock; detectFace: jest.Mock };
  let vault: { canStore: boolean; wanted: boolean; store: jest.Mock; storeAssessment: jest.Mock; storeAutoAudit: jest.Mock; kindsFor: jest.Mock; deleteFor: jest.Mock };
  let configValues: Record<string, unknown>;
  let service: KycService;

  beforeEach(() => {
    queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    repo = {
      exists: jest.fn().mockResolvedValue(false),
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: Record<string, unknown>) => ({ id: 'kyc-1', attempts: 0, verifiedAt: null, failureReason: null, createdAt: new Date(), ...v })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    usersRepo = { findOne: jest.fn().mockResolvedValue({ id: USER, accountStatus: 'active' }) };
    idswyft = {
      initialize: jest.fn().mockResolvedValue(PROVIDER_ID),
      upload: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockResolvedValue({ verificationId: PROVIDER_ID, status: 'COMPLETE', finalResult: 'verified', reason: null, retryAvailable: false }),
    };
    configValues = { 'kyc.enforcement': true, 'kyc.enforcedTypes': [], 'kyc.maxSessionsPerDay': 5 };
    const config = { get: jest.fn((key: string, fallback?: unknown) => (key in configValues ? configValues[key] : fallback)) };
    engine = { enabled: true, readText: jest.fn(), detectFace: jest.fn() };
    vault = {
      canStore: true,
      wanted: false,
      store: jest.fn().mockResolvedValue(true),
      storeAssessment: jest.fn().mockResolvedValue(true),
      storeAutoAudit: jest.fn().mockResolvedValue(true),
      kindsFor: jest.fn().mockResolvedValue([]),
      deleteFor: jest.fn().mockResolvedValue(undefined),
    };
    service = new KycService(repo as never, usersRepo as never, idswyft as never, config as never, engine as never, vault as never);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('assertVerifiedFor', () => {
    const residence = { id: 'residence', kyc: 'required' as const };
    const birth = { id: 'birth', kyc: 'planned' as const };

    it('refuses a required type with the KYC_REQUIRED code when the holder is not verified', async () => {
      const error = await service.assertVerifiedFor(USER, residence).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'KYC_REQUIRED' });
    });

    it('lets a verified holder through, looking for ANY verified dossier (not the latest)', async () => {
      repo.exists.mockResolvedValue(true);
      await expect(service.assertVerifiedFor(USER, residence)).resolves.toBeUndefined();
      expect(repo.exists).toHaveBeenCalledWith({ where: { userId: USER, status: KycStatus.VERIFIED } });
    });

    it('does not block a planned type, and never queries the database for it', async () => {
      await expect(service.assertVerifiedFor(USER, birth)).resolves.toBeUndefined();
      expect(repo.exists).not.toHaveBeenCalled();
    });

    it('blocks a planned type once KYC_ENFORCED_TYPES lists it', async () => {
      configValues['kyc.enforcedTypes'] = ['birth'];
      await expect(service.assertVerifiedFor(USER, birth)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lifts every check when enforcement is off', async () => {
      configValues['kyc.enforcement'] = false;
      await expect(service.assertVerifiedFor(USER, residence)).resolves.toBeUndefined();
    });
  });

  describe('startSession', () => {
    it('opens a provider session bound to our user id and stores only ids and the document type', async () => {
      const view = await service.startSession(USER, 'national_id');

      expect(idswyft.initialize).toHaveBeenCalledWith({ userId: USER, documentType: 'national_id', issuingCountry: undefined });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER, providerVerificationId: PROVIDER_ID, status: KycStatus.PENDING, documentType: 'national_id' }),
      );
      expect(view).toEqual(expect.objectContaining({ status: KycStatus.PENDING, sessionId: 'kyc-1' }));
      expect(JSON.stringify(view)).not.toContain(PROVIDER_ID);
    });

    it('forwards the issuing country to the provider and stores it', async () => {
      await service.startSession(USER, 'passport', 'SN');
      expect(idswyft.initialize).toHaveBeenCalledWith({ userId: USER, documentType: 'passport', issuingCountry: 'SN' });
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ issuingCountry: 'SN' }));
    });

    it('returns the open dossier instead of opening a second provider session', async () => {
      repo.findOne.mockResolvedValue(makeVerification());
      await service.startSession(USER, 'national_id');
      expect(idswyft.initialize).not.toHaveBeenCalled();
    });

    it('returns a verified dossier as is', async () => {
      repo.findOne.mockResolvedValue(makeVerification({ status: KycStatus.VERIFIED, verifiedAt: new Date() }));
      const view = await service.startSession(USER, 'passport');
      expect(view.status).toBe(KycStatus.VERIFIED);
      expect(idswyft.initialize).not.toHaveBeenCalled();
    });

    it('keeps a dossier abandoned for more than a day if the provider already verified it (lost webhook)', async () => {
      repo.findOne.mockResolvedValue(makeVerification({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }));
      const view = await service.startSession(USER, 'national_id');
      expect(view.status).toBe(KycStatus.VERIFIED);
      expect(idswyft.initialize).not.toHaveBeenCalled();
    });

    it('closes a pending dossier abandoned for more than a day, then opens a new one', async () => {
      idswyft.getStatus.mockResolvedValue({ verificationId: PROVIDER_ID, status: 'AWAITING_FRONT', finalResult: null, reason: null, retryAvailable: false });
      repo.findOne.mockResolvedValue(makeVerification({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }));
      await service.startSession(USER, 'national_id');
      expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'kyc-1' }), expect.objectContaining({ status: KycStatus.FAILED }));
      expect(idswyft.initialize).toHaveBeenCalledTimes(1);
    });

    it('answers 429 once the daily cap is reached, without calling the provider', async () => {
      repo.count.mockResolvedValue(5);
      await expect(service.startSession(USER, 'national_id')).rejects.toBeInstanceOf(HttpException);
      expect(idswyft.initialize).not.toHaveBeenCalled();
    });

    it('refuses a suspended account', async () => {
      usersRepo.findOne.mockResolvedValue({ id: USER, accountStatus: 'suspended' });
      await expect(service.startSession(USER, 'national_id')).rejects.toBeInstanceOf(ForbiddenException);
      expect(idswyft.initialize).not.toHaveBeenCalled();
    });

    it('keeps the dossier pending, without an error, when the read-back after the selfie fails', async () => {
      repo.findOne.mockResolvedValue(makeVerification());
      idswyft.getStatus.mockRejectedValue(new IdswyftApiError('down', null, null));
      const view = await service.uploadStep(USER, 'kyc-1', 'selfie', { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg' });
      expect(view.status).toBe(KycStatus.PENDING);
    });

    it('answers 504 with its own code when the provider takes too long, and reads the progress back', async () => {
      repo.findOne.mockResolvedValue(makeVerification());
      idswyft.upload.mockRejectedValue(new IdswyftApiError('timeout', null, null, 'timeout', 'ECONNABORTED'));
      idswyft.getStatus.mockResolvedValue({ verificationId: PROVIDER_ID, status: 'AWAITING_BACK', finalResult: null, reason: null, retryAvailable: false });

      const error = await service
        .uploadStep(USER, 'kyc-1', 'front', { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg' })
        .catch((e: unknown) => e);

      expect((error as HttpException).getStatus()).toBe(504);
      expect(((error as HttpException).getResponse() as { code: string }).code).toBe('KYC_PROVIDER_TIMEOUT');
      // The photo may have arrived: the state is read back (best effort) so the app can resume at the right photo.
      expect(idswyft.getStatus).toHaveBeenCalledTimes(1);
    });

    it('answers 503 with a distinct code when the provider cannot be reached at all', async () => {
      repo.findOne.mockResolvedValue(makeVerification());
      idswyft.upload.mockRejectedValue(new IdswyftApiError('refused', null, null, 'network', 'ECONNREFUSED'));

      const error = await service
        .uploadStep(USER, 'kyc-1', 'front', { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg' })
        .catch((e: unknown) => e);

      expect((error as HttpException).getStatus()).toBe(503);
      expect(((error as HttpException).getResponse() as { code: string }).code).toBe('KYC_PROVIDER_UNREACHABLE');
      expect(idswyft.getStatus).not.toHaveBeenCalled();
    });

    it('classifies an error without HTTP answer as a network failure by default', () => {
      expect(new IdswyftApiError('x', null, null).kind).toBe('network');
      expect(new IdswyftApiError('x', 500, null).kind).toBe('http');
    });

    it('turns a provider outage into a 503-class error without leaking details', async () => {
      idswyft.initialize.mockRejectedValue(new IdswyftApiError('boom', null, null));
      const error = await service.startSession(USER, 'national_id').catch((e: unknown) => e);
      expect((error as HttpException).getStatus()).toBe(503);
    });
  });

  describe('uploadStep', () => {
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg' };

    it("answers 404 for another user's session", async () => {
      await expect(service.uploadStep('intruder', 'kyc-1', 'front', file)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'kyc-1', userId: 'intruder' } });
      expect(idswyft.upload).not.toHaveBeenCalled();
    });

    it('forwards the photo and keeps the dossier pending after a front upload', async () => {
      repo.findOne.mockResolvedValue(makeVerification());
      const view = await service.uploadStep(USER, 'kyc-1', 'front', file);
      expect(idswyft.upload).toHaveBeenCalledWith(PROVIDER_ID, 'front', file);
      expect(idswyft.getStatus).not.toHaveBeenCalled();
      expect(view.status).toBe(KycStatus.PENDING);
    });

    it('reads the verdict back from the provider after the selfie and records verified', async () => {
      repo.findOne.mockResolvedValue(makeVerification());
      const view = await service.uploadStep(USER, 'kyc-1', 'selfie', file);
      expect(idswyft.getStatus).toHaveBeenCalledWith(PROVIDER_ID);
      expect(view.status).toBe(KycStatus.VERIFIED);
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'kyc-1' }),
        expect.objectContaining({ status: KycStatus.VERIFIED, failureReason: null, verifiedAt: expect.any(Date) }),
      );
    });

    it('refuses a back side for a passport', async () => {
      repo.findOne.mockResolvedValue(makeVerification({ documentType: 'passport' }));
      await expect(service.uploadStep(USER, 'kyc-1', 'back', file)).rejects.toBeInstanceOf(BadRequestException);
      expect(idswyft.upload).not.toHaveBeenCalled();
    });

    it('refuses photos on a dossier that is no longer pending', async () => {
      repo.findOne.mockResolvedValue(makeVerification({ status: KycStatus.FAILED }));
      await expect(service.uploadStep(USER, 'kyc-1', 'front', file)).rejects.toBeInstanceOf(ConflictException);
    });

    it('counts the upload atomically and answers 429 without forwarding when the cap is reached', async () => {
      repo.findOne.mockResolvedValue(makeVerification({ attempts: KYC_MAX_UPLOADS_PER_SESSION }));
      queryBuilder.execute.mockResolvedValue({ affected: 0 });
      await expect(service.uploadStep(USER, 'kyc-1', 'front', file)).rejects.toBeInstanceOf(HttpException);
      expect(queryBuilder.where).toHaveBeenCalledWith(expect.stringContaining('attempts < :cap'), expect.objectContaining({ cap: KYC_MAX_UPLOADS_PER_SESSION }));
      expect(idswyft.upload).not.toHaveBeenCalled();
    });

    it('records the closure when the provider answers 409 (session closed on its side)', async () => {
      repo.findOne.mockResolvedValue(makeVerification());
      idswyft.upload.mockRejectedValue(new IdswyftApiError('x', 409, null));
      idswyft.getStatus.mockResolvedValue({ verificationId: PROVIDER_ID, status: 'HARD_REJECTED', finalResult: 'failed', reason: 'Name is Awa Ndiaye', retryAvailable: false });

      await expect(service.uploadStep(USER, 'kyc-1', 'front', file)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: KycStatus.REJECTED, failureReason: 'rejected' }),
      );
    });
  });

  describe('cancelSession', () => {
    it("answers 404 for another user's session", async () => {
      await expect(service.cancelSession('intruder', 'kyc-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('closes an open session as failed so a new one can start', async () => {
      repo.findOne.mockResolvedValue(makeVerification());
      const view = await service.cancelSession(USER, 'kyc-1');
      expect(view.status).toBe(KycStatus.FAILED);
      expect(view.canRestart).toBe(true);
      expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'kyc-1' }), expect.objectContaining({ status: KycStatus.FAILED, failureReason: 'other' }));
    });

    it.each([KycStatus.VERIFIED, KycStatus.MANUAL_REVIEW, KycStatus.REJECTED])('leaves a %s dossier untouched', async (status) => {
      repo.findOne.mockResolvedValue(makeVerification({ status }));
      const view = await service.cancelSession(USER, 'kyc-1');
      expect(view.status).toBe(status);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('precheck', () => {
    const photo = { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg' };
    const cardText = "REPUBLIQUE DU SENEGAL CARTE D'IDENTITE CEDEAO Prenoms Nom Date de naissance";

    beforeEach(() => repo.findOne.mockResolvedValue(makeVerification()));

    it("answers 404 for another user's session, without calling the engine", async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.precheck('intruder', 'kyc-1', 'front', photo)).rejects.toBeInstanceOf(NotFoundException);
      expect(engine.readText).not.toHaveBeenCalled();
    });

    it('accepts a front that reads like an identity card', async () => {
      engine.readText.mockResolvedValue({ rawText: cardText, detectedType: 'national_id', confidence: 0.85 });
      await expect(service.precheck(USER, 'kyc-1', 'front', photo)).resolves.toBe('ok');
    });

    it('refuses a front with no document wording (a wall, a ceiling, a hand)', async () => {
      engine.readText.mockResolvedValue({ rawText: 'a  b  ', detectedType: 'drivers_license', confidence: 0.5 });
      await expect(service.precheck(USER, 'kyc-1', 'front', photo)).resolves.toBe('no_document');
    });

    it('refuses a back whose machine-readable zone is visible but not legible, accepts it once legible', async () => {
      const zone = 'IDSEN' + '<'.repeat(25) + '\n' + 'ABCDE' + '<'.repeat(25);
      engine.readText.mockResolvedValue({ rawText: zone, detectedType: null, confidence: null, mrz: { shapedLikeTd1: true, checkDigitsValid: false } });
      await expect(service.precheck(USER, 'kyc-1', 'back', photo)).resolves.toBe('mrz_unreadable');
      engine.readText.mockResolvedValue({ rawText: zone, detectedType: null, confidence: null, mrz: { shapedLikeTd1: true, checkDigitsValid: true } });
      await expect(service.precheck(USER, 'kyc-1', 'back', photo)).resolves.toBe('ok');
    });

    it('checks a selfie for a face', async () => {
      engine.detectFace.mockResolvedValue(false);
      await expect(service.precheck(USER, 'kyc-1', 'selfie', photo)).resolves.toBe('no_face');
      engine.detectFace.mockResolvedValue(true);
      await expect(service.precheck(USER, 'kyc-1', 'selfie', photo)).resolves.toBe('ok');
    });

    it('is skipped (the photo is sent as usual) when the engine is off or fails', async () => {
      engine.enabled = false;
      await expect(service.precheck(USER, 'kyc-1', 'front', photo)).resolves.toBe('skipped');
      engine.enabled = true;
      engine.readText.mockRejectedValue(new Error('engine down'));
      await expect(service.precheck(USER, 'kyc-1', 'front', photo)).resolves.toBe('skipped');
    });

    it('answers 429 once the per-session precheck budget is used up', async () => {
      engine.readText.mockResolvedValue({ rawText: cardText, detectedType: 'national_id', confidence: 0.85 });
      for (let i = 0; i < 100; i += 1) await service.precheck(USER, 'kyc-1', 'front', photo);
      const error = await service.precheck(USER, 'kyc-1', 'front', photo).catch((e: unknown) => e);
      expect((error as HttpException).getStatus()).toBe(429);
    });

    it('never counts as an upload and never changes the dossier', async () => {
      engine.readText.mockResolvedValue({ rawText: cardText, detectedType: 'national_id', confidence: 0.85 });
      await service.precheck(USER, 'kyc-1', 'front', photo);
      expect(queryBuilder.execute).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(idswyft.upload).not.toHaveBeenCalled();
    });

    it('refuses a back side for a passport and a precheck on a closed dossier', async () => {
      repo.findOne.mockResolvedValue(makeVerification({ documentType: 'passport' }));
      await expect(service.precheck(USER, 'kyc-1', 'back', photo)).rejects.toBeInstanceOf(BadRequestException);
      repo.findOne.mockResolvedValue(makeVerification({ status: KycStatus.FAILED }));
      await expect(service.precheck(USER, 'kyc-1', 'front', photo)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('refreshFromProvider', () => {
    it('never stores the provider wording of a failure, only a fixed reason', async () => {
      const verification = makeVerification();
      idswyft.getStatus.mockResolvedValue({ verificationId: PROVIDER_ID, status: 'COMPLETE', finalResult: 'failed', reason: 'Document 123456 of AWA NDIAYE is blurry', retryAvailable: true });

      await service.refreshFromProvider(verification as never);

      expect(verification.status).toBe(KycStatus.FAILED);
      expect(verification.failureReason).toBe('document_unreadable');
      expect(JSON.stringify(repo.update.mock.calls)).not.toContain('NDIAYE');
    });

    it('fails closed when the provider answers for another verification id', async () => {
      const verification = makeVerification();
      idswyft.getStatus.mockResolvedValue({ verificationId: 'someone-elses', status: 'COMPLETE', finalResult: 'verified', reason: null, retryAvailable: false });

      await expect(service.refreshFromProvider(verification as never)).rejects.toBeInstanceOf(BadGatewayException);
      expect(verification.status).toBe(KycStatus.PENDING);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('does not mark verified while the provider has no final result', async () => {
      const verification = makeVerification();
      idswyft.getStatus.mockResolvedValue({ verificationId: PROVIDER_ID, status: 'AWAITING_LIVE', finalResult: null, reason: null, retryAvailable: false });
      await service.refreshFromProvider(verification as never);
      expect(verification.status).toBe(KycStatus.PENDING);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('tolerates a status answer without verification_id (the URL pins the id), but still verifies', async () => {
      const verification = makeVerification();
      idswyft.getStatus.mockResolvedValue({ verificationId: null, status: 'COMPLETE', finalResult: 'verified', reason: null, retryAvailable: false });
      await service.refreshFromProvider(verification as never);
      expect(verification.status).toBe(KycStatus.VERIFIED);
    });

    it('closes the dossier when the provider no longer knows the session (404), instead of a photo error', async () => {
      const verification = makeVerification();
      idswyft.getStatus.mockRejectedValue(new IdswyftApiError('gone', 404, null));
      await service.refreshFromProvider(verification as never);
      expect(verification.status).toBe(KycStatus.FAILED);
      expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'kyc-1' }), expect.objectContaining({ status: KycStatus.FAILED, failureReason: 'other' }));
    });

    it('maps a provider error on the read-back to a 5xx, never to the photo-refused 400', async () => {
      const verification = makeVerification();
      idswyft.getStatus.mockRejectedValue(new IdswyftApiError('bad', 400, null));
      const error = await service.refreshFromProvider(verification as never).catch((e: unknown) => e);
      expect((error as HttpException).getStatus()).toBe(502);
    });

    it('records where the provider session stopped so the app can resume there', async () => {
      const verification = makeVerification();
      idswyft.getStatus.mockResolvedValue({ verificationId: PROVIDER_ID, status: 'AWAITING_BACK', finalResult: null, reason: null, retryAvailable: false });
      await service.refreshFromProvider(verification as never);
      repo.findOne.mockResolvedValue(verification);
      const view = await service.startSession(USER, 'national_id');
      expect(view.nextStep).toBe('back');
    });

    it('never touches a verified dossier (write-once)', async () => {
      const verification = makeVerification({ status: KycStatus.VERIFIED });
      await service.refreshFromProvider(verification as never);
      expect(idswyft.getStatus).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('writes conditionally on the dossier still being open, and keeps the stored row when it lost the race', async () => {
      const verification = makeVerification();
      repo.update.mockResolvedValue({ affected: 0 });
      repo.findOne.mockResolvedValue(makeVerification({ status: KycStatus.VERIFIED }));

      await service.refreshFromProvider(verification as never);

      const where = repo.update.mock.calls[0][0] as { status: { _value: string[] } };
      expect(where.status._value).toEqual([KycStatus.PENDING, KycStatus.MANUAL_REVIEW]);
      expect(verification.status).toBe(KycStatus.VERIFIED);
    });
  });

  describe('getStatus', () => {
    it('reports not_started for a holder without dossier', async () => {
      const view = await service.getStatus(USER);
      expect(view.status).toBe('not_started');
      expect(view.canRestart).toBe(true);
    });

    it('reads the provider at most once per window while the app polls', async () => {
      repo.findOne.mockResolvedValue(makeVerification());
      await service.getStatus(USER);
      await service.getStatus(USER);
      expect(idswyft.getStatus).toHaveBeenCalledTimes(1);
    });

    it('prefers the verified dossier over a newer failed one', async () => {
      repo.findOne.mockImplementation(async ({ where }: { where: { status?: string } }) =>
        where.status === KycStatus.VERIFIED ? makeVerification({ status: KycStatus.VERIFIED }) : makeVerification({ status: KycStatus.FAILED }),
      );
      const view = await service.getStatus(USER);
      expect(view.status).toBe(KycStatus.VERIFIED);
    });

    it('still answers when the provider is down for a pending dossier', async () => {
      repo.findOne.mockResolvedValue(makeVerification());
      idswyft.getStatus.mockRejectedValue(new IdswyftApiError('x', null, null));
      const view = await service.getStatus(USER);
      expect(view.status).toBe(KycStatus.PENDING);
    });

    it('exposes a restart only for a closed-negative dossier and hides provider failure wording', async () => {
      repo.findOne.mockResolvedValue(makeVerification({ status: KycStatus.FAILED, failureReason: 'Name AWA does not match' }));
      const view = await service.getStatus(USER);
      expect(view.canRestart).toBe(true);
      expect(view.failureReason).toBeNull();
    });
  });

  describe('manual review flags', () => {
    const photo = { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg' };

    describe('fallback to an agent', () => {
      beforeEach(() => {
        configValues['kyc.fallbackManualReview'] = true;
        vault.wanted = true;
      });

      it('keeps a copy of the photo before the provider sees it', async () => {
        repo.findOne.mockResolvedValue(makeVerification());
        await service.uploadStep(USER, 'kyc-1', 'front', photo);
        expect(vault.store).toHaveBeenCalledWith('kyc-1', 'front', photo);
        expect(vault.store.mock.invocationCallOrder[0]).toBeLessThan(idswyft.upload.mock.invocationCallOrder[0]);
      });

      it('detaches the dossier instead of failing when the provider closed the session (409), and asks for the missing photos', async () => {
        repo.findOne.mockResolvedValue(makeVerification());
        idswyft.upload.mockRejectedValue(new IdswyftApiError('closed', 409, null));
        vault.kindsFor.mockResolvedValue(['front']);

        const view = await service.uploadStep(USER, 'kyc-1', 'front', photo);

        expect(repo.update).toHaveBeenCalledWith({ id: 'kyc-1', status: KycStatus.PENDING }, { reviewOrigin: 'fallback', failureReason: 'other' });
        expect(view.status).toBe(KycStatus.PENDING);
        expect(view.nextStep).toBe('back');
        expect(view.reviewMode).toBe('agent');
      });

      it('moves a detached dossier to manual_review once every photo is kept', async () => {
        repo.findOne.mockResolvedValue(makeVerification({ reviewOrigin: 'fallback' }));
        vault.kindsFor.mockResolvedValue(['front', 'back', 'selfie']);

        const view = await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

        expect(idswyft.upload).not.toHaveBeenCalled();
        expect(repo.update).toHaveBeenCalledWith({ id: 'kyc-1', status: KycStatus.PENDING }, { status: KycStatus.MANUAL_REVIEW });
        expect(view.status).toBe(KycStatus.MANUAL_REVIEW);
      });

      it('sends a provider hard rejection to the agent instead of rejecting the holder', async () => {
        repo.findOne.mockResolvedValue(makeVerification());
        idswyft.getStatus.mockResolvedValue({
          verificationId: PROVIDER_ID,
          status: 'HARD_REJECTED',
          finalResult: 'failed',
          reason: 'BACK_MRZ_CHECKSUM_FAILED',
          retryAvailable: false,
        });
        vault.kindsFor.mockResolvedValue(['front', 'back', 'selfie']);

        const view = await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

        expect(repo.update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: KycStatus.REJECTED }));
        expect(view.status).toBe(KycStatus.MANUAL_REVIEW);
      });

      describe('assessment of the automatic check', () => {
        const hardRejected = (assessment: KycAssessment | null) => ({
          verificationId: PROVIDER_ID,
          status: 'HARD_REJECTED',
          finalResult: 'failed',
          reason: 'FRONT_OCR_FAILED',
          retryAvailable: true,
          assessment,
        });

        it('keeps what the provider read before the dossier goes to the agent (reason: document unreadable)', async () => {
          const assessment = makeAssessment();
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(hardRejected(assessment));
          vault.kindsFor.mockResolvedValue(['front', 'back', 'selfie']);

          const view = await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

          expect(vault.storeAssessment).toHaveBeenCalledWith('kyc-1', assessment);
          expect(repo.update).toHaveBeenCalledWith({ id: 'kyc-1', status: KycStatus.PENDING }, { reviewOrigin: 'fallback', failureReason: 'document_unreadable' });
          expect(vault.storeAssessment.mock.invocationCallOrder[0]).toBeLessThan(repo.update.mock.invocationCallOrder[0]);
          expect(view.status).toBe(KycStatus.MANUAL_REVIEW);
          // failure_reason keeps only the mapped code: the provider wording stays out of the dossier row.
          expect(JSON.stringify(repo.update.mock.calls)).not.toContain('FRONT_OCR_FAILED');
          expect(JSON.stringify(repo.update.mock.calls)).not.toContain('Awa');
        });

        it('keeps nothing when the provider returned no data (outage, ocr_data null): the agent then sees an explicit "no data" state', async () => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(hardRejected(null));
          vault.kindsFor.mockResolvedValue(['front', 'back', 'selfie']);

          const view = await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

          expect(vault.storeAssessment).not.toHaveBeenCalled();
          expect(view.status).toBe(KycStatus.MANUAL_REVIEW);
        });

        it('never keeps it for a dossier the provider verified by itself (nobody would look at it)', async () => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue({ verificationId: PROVIDER_ID, status: 'COMPLETE', finalResult: 'verified', reason: null, retryAvailable: false, assessment: makeAssessment({ finalResult: 'verified' }) });
          await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

          expect(vault.storeAssessment).not.toHaveBeenCalled();
        });

        it('keeps it for a face failure too: an agent arbitrates every refusal while the fallback is on', async () => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue({ verificationId: PROVIDER_ID, status: 'COMPLETE', finalResult: 'failed', reason: 'face mismatch', retryAvailable: true, assessment: makeAssessment() });
          vault.kindsFor.mockResolvedValue(['front', 'back', 'selfie']);
          await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

          expect(vault.storeAssessment).toHaveBeenCalledTimes(1);
        });

        it('keeps it as soon as the provider has read something on an open dossier, once per distinct content', async () => {
          const verification = makeVerification();
          const inProgress = { verificationId: PROVIDER_ID, status: 'AWAITING_BACK', finalResult: null, reason: null, retryAvailable: false };
          const read = (over: Partial<KycAssessment> = {}) => makeAssessment({ providerStep: 'AWAITING_BACK', finalResult: null, rejectionCode: null, ...over });
          idswyft.getStatus.mockResolvedValue({ ...inProgress, assessment: read() });

          await service.refreshFromProvider(verification as never);
          // The 3 s poll reads the same thing again, with a new read date: no rewrite.
          idswyft.getStatus.mockResolvedValue({ ...inProgress, assessment: read({ readAt: '2026-10-18T09:00:09.000Z' }) });
          await service.refreshFromProvider(verification as never);
          expect(vault.storeAssessment).toHaveBeenCalledTimes(1);

          idswyft.getStatus.mockResolvedValue({ ...inProgress, assessment: read({ riskScore: 0.5 }) });
          await service.refreshFromProvider(verification as never);
          expect(vault.storeAssessment).toHaveBeenCalledTimes(2);
        });

        it('does not let a failure to keep it change the verdict', async () => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(hardRejected(makeAssessment()));
          vault.storeAssessment.mockRejectedValue(new Error('db down'));
          vault.kindsFor.mockResolvedValue(['front', 'back', 'selfie']);

          const view = await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

          expect(view.status).toBe(KycStatus.MANUAL_REVIEW);
        });

        it('is never in what the holder gets, and never in a log line', async () => {
          const logs: string[] = [];
          for (const level of ['log', 'warn', 'error'] as const) {
            jest.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => void logs.push(String(message)));
          }
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(hardRejected(makeAssessment({ riskScore: 0.77 })));
          vault.kindsFor.mockResolvedValue(['front', 'back', 'selfie']);

          const view = await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

          const serialized = JSON.stringify(view);
          expect(serialized).not.toContain('Awa Diallo');
          expect(serialized).not.toContain('FRONT_OCR_FAILED');
          expect(serialized).not.toMatch(/assessment|ocr|riskScore|0\.77/i);
          expect(logs.join('\n')).not.toContain('Awa Diallo');
          expect(logs.join('\n')).not.toContain('0.77');
        });

        it('after a hard rejection of the FRONT the dossier is detached with reason document_unreadable, and the back precheck is NOT a 409', async () => {
          const verification = makeVerification();
          repo.findOne.mockResolvedValue(verification);
          idswyft.getStatus.mockResolvedValue(hardRejected(makeAssessment()));
          vault.kindsFor.mockResolvedValue(['front']);

          const view = await service.getStatus(USER);

          expect(repo.update).toHaveBeenCalledWith({ id: 'kyc-1', status: KycStatus.PENDING }, { reviewOrigin: 'fallback', failureReason: 'document_unreadable' });
          expect(repo.update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: KycStatus.REJECTED }));
          // The agent can only approve with every photo (no blind approval), so the app goes on to the back and the selfie.
          expect(view).toMatchObject({ status: KycStatus.PENDING, nextStep: 'back', reviewMode: 'agent' });
          engine.enabled = false;
          await expect(service.precheck(USER, 'kyc-1', 'back', photo)).resolves.toBe('skipped');
        });

        it('when the provider answers 409 on the next photo, reads why it stopped: the dossier is detached as document_unreadable, not "other"', async () => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.upload.mockRejectedValue(new IdswyftApiError('closed', 409, null));
          idswyft.getStatus.mockResolvedValue(hardRejected(makeAssessment()));
          vault.kindsFor.mockResolvedValue(['front']);

          const view = await service.uploadStep(USER, 'kyc-1', 'back', photo);

          expect(vault.storeAssessment).toHaveBeenCalledTimes(1);
          expect(repo.update).toHaveBeenCalledWith({ id: 'kyc-1', status: KycStatus.PENDING }, { reviewOrigin: 'fallback', failureReason: 'document_unreadable' });
          expect(view.status).toBe(KycStatus.PENDING);
        });

        it('keeps the default reason when the read after a 409 fails or answers for another session', async () => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.upload.mockRejectedValue(new IdswyftApiError('closed', 409, null));
          idswyft.getStatus.mockRejectedValue(new IdswyftApiError('down', null, null));
          await service.uploadStep(USER, 'kyc-1', 'back', photo);
          expect(repo.update).toHaveBeenCalledWith({ id: 'kyc-1', status: KycStatus.PENDING }, { reviewOrigin: 'fallback', failureReason: 'other' });

          repo.update.mockClear();
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue({ ...hardRejected(makeAssessment()), verificationId: 'someone-else' });
          await service.uploadStep(USER, 'kyc-1', 'back', photo);
          expect(repo.update).toHaveBeenCalledWith({ id: 'kyc-1', status: KycStatus.PENDING }, { reviewOrigin: 'fallback', failureReason: 'other' });
          expect(vault.storeAssessment).not.toHaveBeenCalled();
        });
      });

      describe('every provider refusal is arbitrated by an agent (the holder goes through ALL the steps)', () => {
        const crossValidationFailed = (over: Record<string, unknown> = {}) => ({
          verificationId: PROVIDER_ID,
          status: 'HARD_REJECTED',
          finalResult: 'failed',
          // Observed 2026-10-18: the sentence says nothing useful, the stable code is in the assessment.
          reason: 'Critical field mismatch',
          retryAvailable: false,
          assessment: makeAssessment({ rejectionCode: 'CROSS_VALIDATION_FAILED', rejectionDetail: 'Critical field mismatch', providerStep: 'HARD_REJECTED' }),
          ...over,
        });

        it('keeps a cross-validation rejection after the BACK upload pending and detached, and asks for the SELFIE', async () => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(crossValidationFailed());
          vault.kindsFor.mockResolvedValue(['front', 'back']);

          const view = await service.getStatus(USER);

          expect(repo.update).toHaveBeenCalledWith({ id: 'kyc-1', status: KycStatus.PENDING }, { reviewOrigin: 'fallback', failureReason: 'document_unreadable' });
          expect(repo.update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: KycStatus.REJECTED }));
          expect(repo.update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: KycStatus.FAILED }));
          // The reading (OCR as read, scores, the provider code) is kept for the agent, the photos too.
          expect(vault.storeAssessment).toHaveBeenCalledTimes(1);
          expect(vault.deleteFor).not.toHaveBeenCalled();
          expect(view).toMatchObject({ status: KycStatus.PENDING, nextStep: 'selfie', canRestart: false, reviewMode: 'agent' });
        });

        it('classifies by the provider code, not only by its sentence, and an unexplained rejection is still detached ("rejected")', async () => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(crossValidationFailed({ assessment: null }));
          vault.kindsFor.mockResolvedValue(['front', 'back']);

          const view = await service.getStatus(USER);

          expect(repo.update).toHaveBeenCalledWith({ id: 'kyc-1', status: KycStatus.PENDING }, { reviewOrigin: 'fallback', failureReason: 'rejected' });
          expect(view).toMatchObject({ status: KycStatus.PENDING, nextStep: 'selfie' });
        });

        it('then takes the selfie without calling the closed provider session (no 409 dead end) and waits for the agent', async () => {
          repo.findOne.mockResolvedValue(makeVerification({ reviewOrigin: 'fallback', failureReason: 'document_unreadable' }));
          vault.kindsFor.mockResolvedValue(['front', 'back', 'selfie']);

          const view = await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

          expect(idswyft.upload).not.toHaveBeenCalled();
          expect(repo.update).toHaveBeenCalledWith({ id: 'kyc-1', status: KycStatus.PENDING }, { status: KycStatus.MANUAL_REVIEW });
          expect(view.status).toBe(KycStatus.MANUAL_REVIEW);
        });

        it('does not stop a holder whose SELFIE upload meets the closed session (409): the cross-validation reading is kept, the selfie too', async () => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.upload.mockRejectedValue(new IdswyftApiError('closed', 409, null));
          idswyft.getStatus.mockResolvedValue(crossValidationFailed());
          vault.kindsFor.mockResolvedValue(['front', 'back', 'selfie']);

          const view = await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

          expect(vault.store).toHaveBeenCalledWith('kyc-1', 'selfie', photo);
          expect(repo.update).toHaveBeenCalledWith({ id: 'kyc-1', status: KycStatus.PENDING }, { reviewOrigin: 'fallback', failureReason: 'document_unreadable' });
          expect(view.status).toBe(KycStatus.MANUAL_REVIEW);
        });

        it.each([
          ['a face mismatch', 'face mismatch', 'selfie_mismatch'],
          ['a liveness failure', 'LIVENESS_FAILED', 'liveness_failed'],
          ['an expired document', 'document expired', 'document_expired'],
          ['an unexplained hard rejection (possible forgery)', 'SOMETHING_ELSE', 'rejected'],
        ])('sends %s after the selfie to the agent (manual_review), with the reading, not to a final failure', async (_label, reason, mapped) => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue({
            verificationId: PROVIDER_ID,
            status: reason === 'SOMETHING_ELSE' ? 'HARD_REJECTED' : 'COMPLETE',
            finalResult: 'failed',
            reason,
            retryAvailable: true,
            assessment: makeAssessment({ rejectionCode: null }),
          });
          vault.kindsFor.mockResolvedValue(['front', 'back', 'selfie']);

          const view = await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

          expect(repo.update).toHaveBeenCalledWith({ id: 'kyc-1', status: KycStatus.PENDING }, { reviewOrigin: 'fallback', failureReason: mapped });
          expect(repo.update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: KycStatus.REJECTED }));
          expect(repo.update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: KycStatus.FAILED }));
          expect(vault.storeAssessment).toHaveBeenCalledTimes(1);
          expect(vault.deleteFor).not.toHaveBeenCalled();
          expect(view).toMatchObject({ status: KycStatus.MANUAL_REVIEW, canRestart: false });
          // The holder only sees the generic state: only a fixed code, never the provider's wording.
          expect(JSON.stringify(view)).not.toMatch(/SOMETHING_ELSE|Awa Diallo|FRONT_OCR_FAILED/);
        });

        it('waits for the missing photos when the refusal comes before the selfie, whatever the reason', async () => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue({ verificationId: PROVIDER_ID, status: 'COMPLETE', finalResult: 'failed', reason: 'face mismatch', retryAvailable: true });
          vault.kindsFor.mockResolvedValue(['front']);

          const view = await service.getStatus(USER);

          expect(view).toMatchObject({ status: KycStatus.PENDING, nextStep: 'back' });
        });

        it('hands a provider that forgot the session (404) over to the agent instead of closing the dossier', async () => {
          const verification = makeVerification();
          idswyft.getStatus.mockRejectedValue(new IdswyftApiError('gone', 404, null));
          vault.kindsFor.mockResolvedValue(['front', 'back']);

          await service.refreshFromProvider(verification as never);

          expect(repo.update).toHaveBeenCalledWith({ id: 'kyc-1', status: KycStatus.PENDING }, { reviewOrigin: 'fallback', failureReason: 'other' });
          expect(verification.status).toBe(KycStatus.PENDING);
          expect(vault.deleteFor).not.toHaveBeenCalled();
        });

        it('never leaves a refusal a way for the holder to override: no verified, the daily cap still applies', async () => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(crossValidationFailed());
          vault.kindsFor.mockResolvedValue(['front', 'back', 'selfie']);
          await service.uploadStep(USER, 'kyc-1', 'selfie', photo);
          expect(repo.update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: KycStatus.VERIFIED }));

          repo.findOne.mockResolvedValue(null);
          repo.count.mockResolvedValue(5);
          await expect(service.startSession(USER, 'national_id')).rejects.toBeInstanceOf(HttpException);
        });

        it('logs ids, reasons and states only, never the provider sentence or a value read', async () => {
          const logs: string[] = [];
          for (const level of ['log', 'warn', 'error'] as const) {
            jest.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => void logs.push(String(message)));
          }
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(crossValidationFailed());
          vault.kindsFor.mockResolvedValue(['front', 'back']);

          await service.getStatus(USER);

          const logged = logs.join('\n');
          expect(logged).toContain('detached for agent review');
          expect(logged).not.toContain('Critical field mismatch');
          expect(logged).not.toContain('Awa Diallo');
        });
      });

      describe('the old final behaviour stays when no agent can take over', () => {
        const unexplained = { verificationId: PROVIDER_ID, status: 'HARD_REJECTED', finalResult: 'failed', reason: 'SOMETHING_ELSE', retryAvailable: false };
        const crossFailed = { ...unexplained, reason: 'Critical field mismatch', assessment: makeAssessment({ rejectionCode: 'CROSS_VALIDATION_FAILED' }) };

        it('flag off: a hard rejection is a final rejection and the copies are deleted', async () => {
          configValues['kyc.fallbackManualReview'] = false;
          vault.wanted = false;
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(unexplained);

          const view = await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

          expect(view).toMatchObject({ status: KycStatus.REJECTED, canRestart: true });
          expect(vault.deleteFor).toHaveBeenCalledWith('kyc-1');
          expect(repo.update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reviewOrigin: 'fallback' }));
        });

        it('flag off: a cross-validation rejection and a face mismatch fail the dossier', async () => {
          configValues['kyc.fallbackManualReview'] = false;
          vault.wanted = false;
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(crossFailed);
          expect((await service.getStatus(USER)).status).toBe(KycStatus.REJECTED);

          lastRefreshReset();
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue({ verificationId: PROVIDER_ID, status: 'COMPLETE', finalResult: 'failed', reason: 'face mismatch', retryAvailable: true });
          expect((await service.uploadStep(USER, 'kyc-1', 'selfie', photo)).status).toBe(KycStatus.FAILED);
        });

        it('vault cannot store (no valid key): every refusal is final again, since the agent would have nothing to look at', async () => {
          vault.canStore = false;
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(crossFailed);

          const view = await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

          expect(view).toMatchObject({ status: KycStatus.REJECTED, reviewMode: 'automatic' });
          expect(repo.update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reviewOrigin: 'fallback' }));
        });

        it('flag off: a provider that forgot the session closes the dossier as before', async () => {
          configValues['kyc.fallbackManualReview'] = false;
          const verification = makeVerification();
          idswyft.getStatus.mockRejectedValue(new IdswyftApiError('gone', 404, null));
          await service.refreshFromProvider(verification as never);
          expect(verification.status).toBe(KycStatus.FAILED);
        });

        /** The status poll is throttled per session (3 s): forget it between two reads in the same test. */
        function lastRefreshReset() {
          (service as unknown as { lastRefresh: Map<string, number> }).lastRefresh.clear();
        }
      });

      it('refuses a detached upload when the copy could not be written because the dossier moved on', async () => {
        repo.findOne.mockResolvedValue(makeVerification({ reviewOrigin: 'fallback' }));
        vault.store.mockResolvedValue(false);
        await expect(service.uploadStep(USER, 'kyc-1', 'front', photo)).rejects.toBeInstanceOf(ConflictException);
      });

      it('does not absorb a rate limit (429)', async () => {
        repo.findOne.mockResolvedValue(makeVerification());
        idswyft.upload.mockRejectedValue(new IdswyftApiError('slow down', 429, null));
        await expect(service.uploadStep(USER, 'kyc-1', 'front', photo)).rejects.toBeInstanceOf(HttpException);
        expect(repo.update).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reviewOrigin: 'fallback' }));
      });

      it('falls back to the normal behaviour when no encryption key is configured (the agent would have nothing to see)', async () => {
        vault.canStore = false;
        repo.findOne.mockResolvedValue(makeVerification());
        idswyft.upload.mockRejectedValue(new IdswyftApiError('closed', 409, null));
        await expect(service.uploadStep(USER, 'kyc-1', 'front', photo)).rejects.toBeInstanceOf(ConflictException);
      });

      it('never reads a detached dossier back from the provider', async () => {
        repo.findOne.mockResolvedValue(makeVerification({ reviewOrigin: 'fallback' }));
        await service.getStatus(USER);
        expect(idswyft.getStatus).not.toHaveBeenCalled();
      });
    });

    describe('provider verified', () => {
      it('deletes the kept copies when the dossier is cancelled', async () => {
        repo.findOne.mockResolvedValue(makeVerification());
        await service.cancelSession(USER, 'kyc-1');
        expect(vault.deleteFor).toHaveBeenCalledWith('kyc-1');
      });

      it('deletes the kept copies once the provider verifies the dossier', async () => {
        repo.findOne.mockResolvedValue(makeVerification());
        await service.uploadStep(USER, 'kyc-1', 'selfie', photo);
        expect(vault.deleteFor).toHaveBeenCalledWith('kyc-1');
      });

      describe('audit of an automatic verification', () => {
        const autoAudit = {
          version: 1,
          readAt: '2026-10-18T10:00:00.000Z',
          providerVerdict: 'verified',
          isSandbox: true,
          faceMatch: { score: 0.905, threshold: 0.55, passed: true },
          liveness: { score: 0.91, threshold: null, passed: true },
          crossValidation: { verdict: 'PASS', passed: null, score: 0.88, checks: [{ name: 'date_of_birth', passed: true, score: 1 }] },
          documentExpired: false,
        };
        const verified = (over: Record<string, unknown> = {}) => ({
          verificationId: PROVIDER_ID,
          status: 'COMPLETE',
          finalResult: 'verified',
          reason: null,
          retryAvailable: false,
          assessment: makeAssessment({ finalResult: 'verified' }),
          autoAudit,
          ...over,
        });

        it('keeps the reduced audit AFTER the photos and the OCR assessment are deleted, and not the OCR assessment itself', async () => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(verified());

          const view = await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

          expect(view.status).toBe(KycStatus.VERIFIED);
          expect(vault.storeAutoAudit).toHaveBeenCalledWith('kyc-1', autoAudit);
          expect(vault.deleteFor.mock.invocationCallOrder[0]).toBeLessThan(vault.storeAutoAudit.mock.invocationCallOrder[0]);
          expect(vault.storeAssessment).not.toHaveBeenCalled();
          // The audit carries no value read on the document.
          expect(JSON.stringify(vault.storeAutoAudit.mock.calls)).not.toContain('Awa');
        });

        it('keeps nothing for a dossier that goes to an agent, fails, or is still open', async () => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(verified({ finalResult: 'manual_review' }));
          await service.uploadStep(USER, 'kyc-1', 'selfie', photo);
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(verified({ finalResult: 'failed', reason: 'face mismatch' }));
          await service.uploadStep(USER, 'kyc-1', 'selfie', photo);
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(verified({ finalResult: null, status: 'AWAITING_BACK' }));
          await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

          expect(vault.storeAutoAudit).not.toHaveBeenCalled();
        });

        it('keeps nothing when it lost the race to close the dossier (the stored row wins)', async () => {
          const verification = makeVerification();
          repo.update.mockResolvedValue({ affected: 0 });
          repo.findOne.mockResolvedValue(makeVerification({ status: KycStatus.FAILED }));
          idswyft.getStatus.mockResolvedValue(verified());

          await service.refreshFromProvider(verification as never);

          expect(vault.storeAutoAudit).not.toHaveBeenCalled();
        });

        it('does not let a failure to keep it change the verdict, and logs no value', async () => {
          const logs: string[] = [];
          for (const level of ['log', 'warn', 'error'] as const) {
            jest.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => void logs.push(String(message)));
          }
          vault.storeAutoAudit.mockRejectedValue(new Error('db down'));
          const verification = makeVerification();
          idswyft.getStatus.mockResolvedValue(verified());

          await service.refreshFromProvider(verification as never);

          expect(verification.status).toBe(KycStatus.VERIFIED);
          expect(logs.join('\n')).toContain('kyc auto audit not kept');
          expect(logs.join('\n')).not.toContain('0.905');
        });

        it('says why nothing was kept when there is no encryption key, and still verifies', async () => {
          const logs: string[] = [];
          jest.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => void logs.push(String(message)));
          vault.canStore = false;
          vault.storeAutoAudit.mockResolvedValue(false);
          const verification = makeVerification();
          idswyft.getStatus.mockResolvedValue(verified());

          await service.refreshFromProvider(verification as never);

          expect(verification.status).toBe(KycStatus.VERIFIED);
          expect(logs.join('\n')).toContain('reason=no_encryption_key');
        });

        it('is not in what the holder gets', async () => {
          repo.findOne.mockResolvedValue(makeVerification());
          idswyft.getStatus.mockResolvedValue(verified());
          const view = await service.uploadStep(USER, 'kyc-1', 'selfie', photo);
          expect(JSON.stringify(view)).not.toMatch(/audit|sandbox|0.905|threshold/i);
        });

        it('tolerates an older provider answer without the audit', async () => {
          const verification = makeVerification();
          idswyft.getStatus.mockResolvedValue({ verificationId: PROVIDER_ID, status: 'COMPLETE', finalResult: 'verified', reason: null, retryAvailable: false });
          await service.refreshFromProvider(verification as never);
          expect(verification.status).toBe(KycStatus.VERIFIED);
          expect(vault.storeAutoAudit).not.toHaveBeenCalled();
        });
      });

      it('marks a provider manual_review with its origin', async () => {
        repo.findOne.mockResolvedValue(makeVerification());
        idswyft.getStatus.mockResolvedValue({ verificationId: PROVIDER_ID, status: 'COMPLETE', finalResult: 'manual_review', reason: null, retryAvailable: false });
        await service.uploadStep(USER, 'kyc-1', 'selfie', photo);
        expect(repo.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: KycStatus.MANUAL_REVIEW, reviewOrigin: 'provider' }));
      });
    });

    describe('manual_only provider mode', () => {
      beforeEach(() => {
        configValues['kyc.providerMode'] = 'manual_only';
        vault.wanted = true;
      });

      it('opens a dossier without calling the provider', async () => {
        const view = await service.startSession(USER, 'national_id');
        expect(idswyft.initialize).not.toHaveBeenCalled();
        expect(repo.save).toHaveBeenCalledWith(
          expect.objectContaining({ provider: 'manual', reviewOrigin: 'manual_only', providerVerificationId: expect.stringMatching(/^manual_/) }),
        );
        expect(view.reviewMode).toBe('agent');
      });

      it('refuses to open a dossier without an encryption key', async () => {
        vault.canStore = false;
        await expect(service.startSession(USER, 'national_id')).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(repo.save).not.toHaveBeenCalled();
      });

      it('keeps the photos only, and waits for the agent after the last one', async () => {
        repo.findOne.mockResolvedValue(makeVerification({ documentType: 'passport', reviewOrigin: 'manual_only' }));
        vault.kindsFor.mockResolvedValue(['front', 'selfie']);

        const view = await service.uploadStep(USER, 'kyc-1', 'selfie', photo);

        expect(idswyft.upload).not.toHaveBeenCalled();
        expect(view.status).toBe(KycStatus.MANUAL_REVIEW);
      });

      it('asks for the back of a national id before completing', async () => {
        repo.findOne.mockResolvedValue(makeVerification({ reviewOrigin: 'manual_only' }));
        vault.kindsFor.mockResolvedValue(['front']);
        const view = await service.uploadStep(USER, 'kyc-1', 'front', photo);
        expect(view.status).toBe(KycStatus.PENDING);
        expect(view.nextStep).toBe('back');
      });

      it('propagates a failure to keep the photo: nothing else holds it', async () => {
        repo.findOne.mockResolvedValue(makeVerification({ reviewOrigin: 'manual_only' }));
        vault.store.mockRejectedValue(new Error('db down'));
        await expect(service.uploadStep(USER, 'kyc-1', 'front', photo)).rejects.toThrow('db down');
      });
    });

    describe('MRZ precheck mode', () => {
      const backImage = { buffer: Buffer.from([0xff, 0xd8, 0xff]), mimetype: 'image/jpeg' };
      const mrzText = {
        rawText: 'IDSEN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<\n9001011M3001011SEN<<<<<<<<<<<6\nDIALLO<<AWA<<<<<<<<<<<<<<<<<<<<',
        detectedType: null,
        confidence: 0.9,
        mrz: { shapedLikeTd1: true, checkDigitsValid: false },
      };

      beforeEach(() => {
        repo.findOne.mockResolvedValue(makeVerification());
        engine.readText.mockResolvedValue(mrzText);
      });

      it('reports an unreadable MRZ in strict mode', async () => {
        await expect(service.precheck(USER, 'kyc-1', 'back', backImage)).resolves.toBe('mrz_unreadable');
      });

      it('still reports it in warn mode (the app lets the holder send anyway)', async () => {
        configValues['kyc.mrzPrecheck'] = 'warn';
        await expect(service.precheck(USER, 'kyc-1', 'back', backImage)).resolves.toBe('mrz_unreadable');
        expect((await service.getStatus(USER)).mrzPrecheck).toBe('warn');
      });

      it('ignores the MRZ reading when off', async () => {
        configValues['kyc.mrzPrecheck'] = 'off';
        await expect(service.precheck(USER, 'kyc-1', 'back', backImage)).resolves.toBe('ok');
      });
    });
  });
});

describe('classifyFailureReason', () => {
  it.each([
    ['Image is too blurry', false, 'document_unreadable'],
    ['Document expired on 2020-01-01', false, 'document_expired'],
    ['Face does not match the document', false, 'selfie_mismatch'],
    ['Liveness check failed', false, 'liveness_failed'],
    ['anything', true, 'rejected'],
    ['LIVENESS_FAILED', true, 'liveness_failed'],
    ['CROSS_VALIDATION_FAILED', true, 'document_unreadable'],
    ['BACK_MRZ_CHECKSUM_FAILED', true, 'document_unreadable'],
    [null, false, 'other'],
    ['something unforeseen', false, 'other'],
  ])('%j (hardRejected=%p) -> %s', (reason, hardRejected, expected) => {
    expect(classifyFailureReason(reason, hardRejected)).toBe(expected);
  });
});
