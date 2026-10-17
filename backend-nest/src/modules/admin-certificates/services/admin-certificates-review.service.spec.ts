// `AdminCertificatesService` transitively imports the DID/VC services, which import `jose` (ESM) — unloadable
// under ts-jest/CommonJS. The review flow does not touch it, so a bare stub is enough.
jest.mock('jose', () => ({
  SignJWT: class {},
  jwtVerify: jest.fn(),
  importPKCS8: jest.fn(),
  importSPKI: jest.fn(),
}));

import * as os from 'os';
import * as path from 'path';
import { BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AdminCertificateRequestStatus } from '../entities/admin-certificate-request.entity';
import { ADMIN_CERTIFICATE_TYPES } from '../admin-certificates.constants';
import { RejectRequestDto, RequestInfoDto } from '../dto/review-request.dto';
import { AccessLogAction, AccessLogActorType } from '../../consent/entities/access-log.entity';
import { AdminCertificatesService } from './admin-certificates.service';

const S = AdminCertificateRequestStatus;

const makeRequest = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  holderUserId: 'holder-1',
  organizationId: 'org-1',
  certificateType: 'residence',
  submittedData: { fullName: 'Awa Ndiaye' },
  status: S.PENDING,
  decisionReason: null as string | null,
  reviewedByUserId: null as string | null,
  reviewedAt: null as Date | null,
  paymentId: null as string | null,
  adminCertificateRef: null,
  createdAt: new Date('2026-10-10T10:00:00Z'),
  updatedAt: new Date('2026-10-10T10:05:00Z'),
  ...over,
});

/**
 * Flow B review path: filing (`pending` vs `accepted` by type, deterministic organization), the agent's three
 * decisions (scope, four-eyes, atomic claim, audit) and the holder's resubmission.
 */
describe('AdminCertificatesService — request review flow', () => {
  let requestsRepo: { findOne: jest.Mock; update: jest.Mock; save: jest.Mock; create: jest.Mock };
  let organizationsRepo: { findOne: jest.Mock };
  let usersRepo: { findOne: jest.Mock };
  let kyc: { assertVerifiedFor: jest.Mock };
  let accessLogService: { record: jest.Mock };
  let service: AdminCertificatesService;
  let autoIssue: boolean;

  beforeEach(() => {
    autoIssue = true;
    process.env.ADMIN_CERTIFICATES_STORAGE_DIR = path.join(os.tmpdir(), 'dioteko-spec-storage'); // same value as the sibling specs
    requestsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((v: Record<string, unknown>) => ({ id: 'req-new', ...v })),
      save: jest.fn(async (v: Record<string, unknown>) => v),
    };
    organizationsRepo = { findOne: jest.fn().mockResolvedValue({ id: 'org-1' }) };
    usersRepo = { findOne: jest.fn().mockResolvedValue({ id: 'staff-1', organizationId: 'org-1', accountStatus: 'active' }) };
    accessLogService = { record: jest.fn().mockResolvedValue({}) };
    const config = { get: jest.fn((k: string, d?: unknown) => (k === 'certificates.autoIssue' ? autoIssue : d)) };

    kyc = { assertVerifiedFor: jest.fn().mockResolvedValue(undefined) };
    const args = [
      requestsRepo,
      undefined, // refsRepository
      organizationsRepo,
      undefined, // paymentsRepository
      undefined, // bitnobPayoutsRepository
      undefined, // dataSource
      undefined, // lightningInvoicesService
      undefined, // didService
      undefined, // credentialIssuanceService
      undefined, // credentialVerificationService
      undefined, // certificateAnchorService
      undefined, // certificatePdfService
      config,
      accessLogService,
      undefined, // bitnobPayoutsService
      undefined, // bitnobLightningService
      undefined, // bitnobInvoiceSettlementService
      usersRepo,
      undefined, // revocationService
      kyc,
    ];
    service = new (AdminCertificatesService as unknown as new (...a: unknown[]) => AdminCertificatesService)(...args);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('type catalog', () => {
    it('requires review for residence and identity only', () => {
      const flags = Object.fromEntries(ADMIN_CERTIFICATE_TYPES.map((t) => [t.id, t.requiresReview]));
      expect(flags).toEqual({ birth: false, marriage: false, death: false, residence: true, identity: true });
    });
  });

  describe('createRequest', () => {
    it('asks the KYC gate about the holder and the catalog type before filing anything', async () => {
      await service.createRequest('holder-1', { certificateType: 'residence', submittedData: { fullName: 'Awa Ndiaye' } });
      expect(kyc.assertVerifiedFor).toHaveBeenCalledWith('holder-1', expect.objectContaining({ id: 'residence', kyc: 'required' }));
    });

    it('files nothing when the KYC gate refuses', async () => {
      kyc.assertVerifiedFor.mockRejectedValue(new ForbiddenException({ code: 'KYC_REQUIRED', message: 'kyc' }));
      await expect(
        service.createRequest('holder-1', { certificateType: 'residence', submittedData: { fullName: 'Awa Ndiaye' } }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(requestsRepo.save).not.toHaveBeenCalled();
    });

    it('files a type that requires review as pending', async () => {
      const request = await service.createRequest('holder-1', { certificateType: 'residence', submittedData: { fullName: 'Awa Ndiaye' } });
      expect(request.status).toBe(S.PENDING);
    });

    it('accepts automatically a type that does not require review', async () => {
      const request = await service.createRequest('holder-1', { certificateType: 'birth', submittedData: { fullName: 'Awa Ndiaye' } });
      expect(request.status).toBe(S.ACCEPTED);
    });

    it('files a type without review as pending when automatic issuance is switched off (CERT_AUTO_ISSUE)', async () => {
      autoIssue = false;
      const request = await service.createRequest('holder-1', { certificateType: 'birth', submittedData: { fullName: 'Awa Ndiaye' } });
      expect(request.status).toBe(S.PENDING);
    });

    it('falls back to the OLDEST issuing organization, in a stable order', async () => {
      await service.createRequest('holder-1', { certificateType: 'birth', submittedData: { fullName: 'Awa Ndiaye' } });
      expect(organizationsRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'ASC', id: 'ASC' } }),
      );
    });

    it('uses the chosen organization only if it is an issuing one (id AND type in the same query)', async () => {
      await service.createRequest('holder-1', {
        certificateType: 'birth',
        submittedData: { fullName: 'Awa Ndiaye' },
        organizationId: 'org-9',
      });
      const arg = organizationsRepo.findOne.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(arg.where).toHaveProperty('id', 'org-9');
      expect(arg.where).toHaveProperty('type');
      expect(requestsRepo.create).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1' }));
    });

    it('answers 400 for a chosen organization that is not an issuing one', async () => {
      organizationsRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createRequest('holder-1', { certificateType: 'birth', submittedData: { fullName: 'Awa Ndiaye' }, organizationId: 'org-9' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(requestsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('createRequest input', () => {
    it('refuses an empty submittedData (it would become an empty credential subject)', async () => {
      await expect(service.createRequest('holder-1', { certificateType: 'birth', submittedData: {} })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(requestsRepo.save).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown key', { fullName: 'Awa Ndiaye', isAdmin: 'yes' }],
      ['a missing fullName', { nationality: 'Sénégalaise' }],
      ['a non-string value', { fullName: 42 }],
      ['a blank value', { fullName: '   ' }],
      ['an over-long value', { fullName: 'x'.repeat(201) }],
      ['an array', ['fullName']],
    ])('refuses %s in submittedData, on filing and on resubmit', async (_label, submittedData) => {
      await expect(
        service.createRequest('holder-1', { certificateType: 'birth', submittedData: submittedData as never }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(requestsRepo.save).not.toHaveBeenCalled();
      await expect(service.resubmitRequest('req-1', 'holder-1', submittedData as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('returns the holder view, not the raw entity', async () => {
      const view = await service.createRequest('holder-1', { certificateType: 'residence', submittedData: { fullName: 'Awa Ndiaye' } });
      expect(view).not.toHaveProperty('holderUserId');
      expect(view).not.toHaveProperty('organizationId');
      expect(view).not.toHaveProperty('reviewedByUserId');
      expect(view).toMatchObject({ certificateType: 'residence', status: S.PENDING, priceSats: 100 });
    });
  });

  describe.each([
    ['accept', S.ACCEPTED, undefined],
    ['reject', S.REJECTED, 'Birth record not found in the register'],
    ['request_info', S.NEEDS_INFO, 'Please add the page of the family book'],
  ] as const)('agent decision %s', (decision, nextStatus, text) => {
    const run = (requestId = 'req-1', actor = 'staff-1') =>
      decision === 'accept'
        ? service.acceptRequest(requestId, actor)
        : decision === 'reject'
          ? service.rejectRequest(requestId, actor, text!)
          : service.requestInfo(requestId, actor, text!);

    it(`moves a pending request to ${nextStatus} with an atomic claim scoped to the organization`, async () => {
      requestsRepo.findOne.mockResolvedValue(makeRequest());

      const view = await run();

      expect(requestsRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'req-1', organizationId: 'org-1' } }),
      );
      expect(requestsRepo.update).toHaveBeenCalledWith(
        { id: 'req-1', organizationId: 'org-1', status: S.PENDING },
        expect.objectContaining({ status: nextStatus, decisionReason: text ?? null, reviewedByUserId: 'staff-1' }),
      );
      expect(view.status).toBe(nextStatus);
      expect(view.decisionReason).toBe(text ?? null);
      expect(view).not.toHaveProperty('paymentId');
    });

    it('writes an audit row with the decision and no free text', async () => {
      requestsRepo.findOne.mockResolvedValue(makeRequest());

      await run();

      expect(accessLogService.record).toHaveBeenCalledTimes(1);
      const entry = accessLogService.record.mock.calls[0][0] as Record<string, unknown>;
      expect(entry).toMatchObject({
        actorType: AccessLogActorType.ISSUER_ORGANIZATION,
        actorOrganizationId: 'org-1',
        actorUserId: 'staff-1',
        resourceId: 'req-1',
        action: AccessLogAction.REVIEW,
      });
      expect(JSON.stringify(entry.metadata)).toContain(decision);
      if (text) expect(JSON.stringify(entry.metadata)).not.toContain(text);
    });

    it("answers 404 for another organization's request, without any write", async () => {
      requestsRepo.findOne.mockResolvedValue(null); // the organization is in the WHERE: nothing matches

      await expect(run('req-of-org-2')).rejects.toBeInstanceOf(NotFoundException);
      expect(requestsRepo.update).not.toHaveBeenCalled();
      expect(accessLogService.record).not.toHaveBeenCalled();
    });

    it('refuses an agent who is also the holder (four eyes)', async () => {
      requestsRepo.findOne.mockResolvedValue(makeRequest({ holderUserId: 'staff-1' }));

      await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
      expect(requestsRepo.update).not.toHaveBeenCalled();
    });

    it.each([S.ACCEPTED, S.NEEDS_INFO, S.REJECTED, S.AWAITING_PAYMENT, S.PAID, S.ISSUING, S.ISSUED])(
      'answers 409 when the request is already %s',
      async (status) => {
        requestsRepo.findOne.mockResolvedValue(makeRequest({ status }));

        await expect(run()).rejects.toBeInstanceOf(ConflictException);
        expect(requestsRepo.update).not.toHaveBeenCalled();
      },
    );

    it('answers 409 when another agent won the claim in between', async () => {
      requestsRepo.findOne.mockResolvedValue(makeRequest());
      requestsRepo.update.mockResolvedValue({ affected: 0 });

      await expect(run()).rejects.toBeInstanceOf(ConflictException);
      expect(accessLogService.record).not.toHaveBeenCalled();
    });

    it('keeps the committed decision and logs AUDIT_MISSING when the audit write fails', async () => {
      requestsRepo.findOne.mockResolvedValue(makeRequest());
      accessLogService.record.mockRejectedValue(new Error('db down'));
      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      const view = await run();

      expect(view.status).toBe(nextStatus);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('AUDIT_MISSING'));
    });

    it('refuses a suspended agent before reading the request', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'staff-1', organizationId: 'org-1', accountStatus: 'suspended' });

      await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
      expect(requestsRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('resubmitRequest', () => {
    it('replaces submittedData and sends a needs_info request back to pending, by its holder only', async () => {
      requestsRepo.findOne.mockResolvedValue(makeRequest({ status: S.NEEDS_INFO, decisionReason: 'Add the page' }));

      const view = await service.resubmitRequest('req-1', 'holder-1', { fullName: 'Awa Ndiaye', nationality: 'Sénégalaise' });

      expect(requestsRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'req-1', holderUserId: 'holder-1' } }),
      );
      expect(requestsRepo.update).toHaveBeenCalledWith(
        { id: 'req-1', holderUserId: 'holder-1', status: S.NEEDS_INFO },
        { submittedData: { fullName: 'Awa Ndiaye', nationality: 'Sénégalaise' }, status: S.PENDING, decisionReason: null },
      );
      expect(view.status).toBe(S.PENDING);
      expect(view.submittedData).toEqual({ fullName: 'Awa Ndiaye', nationality: 'Sénégalaise' });
    });

    it('answers 404 for a request that is not the caller\'s', async () => {
      await expect(service.resubmitRequest('req-1', 'someone-else', { fullName: 'Awa Ndiaye' })).rejects.toBeInstanceOf(NotFoundException);
      expect(requestsRepo.update).not.toHaveBeenCalled();
    });

    it('refuses the resubmission, and keeps needs_info, when the KYC gate refuses', async () => {
      requestsRepo.findOne.mockResolvedValue(makeRequest({ status: S.NEEDS_INFO }));
      kyc.assertVerifiedFor.mockRejectedValue(new ForbiddenException({ code: 'KYC_REQUIRED', message: 'kyc' }));
      await expect(service.resubmitRequest('req-1', 'holder-1', { fullName: 'Awa Ndiaye' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(requestsRepo.update).not.toHaveBeenCalled();
    });

    it('clears the agent message once answered, and refuses an empty answer', async () => {
      requestsRepo.findOne.mockResolvedValue(makeRequest({ status: S.NEEDS_INFO, decisionReason: 'Add the page' }));

      const view = await service.resubmitRequest('req-1', 'holder-1', { fullName: 'Awa Ndiaye' });

      expect(view.decisionReason).toBeNull();
      expect(requestsRepo.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ decisionReason: null }));
      await expect(service.resubmitRequest('req-1', 'holder-1', {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([S.PENDING, S.ACCEPTED, S.REJECTED, S.PAID, S.ISSUED])('answers 409 from %s', async (status) => {
      requestsRepo.findOne.mockResolvedValue(makeRequest({ status }));

      await expect(service.resubmitRequest('req-1', 'holder-1', { fullName: 'Awa Ndiaye' })).rejects.toBeInstanceOf(ConflictException);
      expect(requestsRepo.update).not.toHaveBeenCalled();
    });

    it('answers 409 on a double submit that loses the claim', async () => {
      requestsRepo.findOne.mockResolvedValue(makeRequest({ status: S.NEEDS_INFO }));
      requestsRepo.update.mockResolvedValue({ affected: 0 });

      await expect(service.resubmitRequest('req-1', 'holder-1', { fullName: 'Awa Ndiaye' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('decision DTOs', () => {
    it.each([
      [RejectRequestDto, 'reason'],
      [RequestInfoDto, 'message'],
    ] as const)('%p requires 10 to 500 characters of text, trimmed', async (Dto, field) => {
      const check = (value: unknown) => validate(plainToInstance(Dto as new () => object, { [field]: value }));

      expect(await check('too short')).not.toHaveLength(0); // 9
      expect(await check('   short    ')).not.toHaveLength(0); // trimmed to 5
      expect(await check(undefined)).not.toHaveLength(0);
      expect(await check('x'.repeat(501))).not.toHaveLength(0);
      expect(await check('x'.repeat(10))).toHaveLength(0);
      expect(await check('x'.repeat(500))).toHaveLength(0);
    });
  });
});
