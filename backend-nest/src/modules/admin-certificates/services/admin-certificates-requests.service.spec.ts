// `AdminCertificatesService` transitively imports the DID/VC services, which
// import `jose` (ESM) — unloadable under ts-jest/CommonJS. These read paths
// do not touch it, so a bare stub is enough.
jest.mock('jose', () => ({
  SignJWT: class {},
  jwtVerify: jest.fn(),
  importPKCS8: jest.fn(),
  importSPKI: jest.fn(),
}));

import * as os from 'os';
import * as path from 'path';
import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { AdminCertificateRequestStatus } from '../entities/admin-certificate-request.entity';
import { getCertificateTypeDefinition } from '../admin-certificates.constants';
import { VerifiableCredentialStatus } from '../../did-vc/entities/verifiable-credential.entity';
import { AccessLogAction, AccessLogActorType } from '../../consent/entities/access-log.entity';
import { computeValidity } from '../request-validity.util';
import { AdminCertificatesService } from './admin-certificates.service';

const RESIDENCE_PRICE = getCertificateTypeDefinition('residence')!.priceSats;
const DAY_MS = 24 * 60 * 60 * 1000;

type RefStub = { externalReference: string; vcId: string; subjectDidId: string; vc?: { status: string; expiresAt: Date | null } };

const makeRequest = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  holderUserId: 'holder-1',
  organizationId: 'org-1',
  certificateType: 'residence',
  submittedData: { fullName: 'Awa Ndiaye' },
  status: AdminCertificateRequestStatus.PENDING,
  paymentId: null as string | null,
  adminCertificateRef: null as RefStub | null,
  createdAt: new Date('2026-10-10T10:00:00Z'),
  updatedAt: new Date('2026-10-10T10:05:00Z'),
  ...over,
});

/**
 * Read paths of `AdminCertificatesService`: the citizen's "my requests" (list / detail / stats) and the staff
 * "organization requests". They must be scoped (caller / caller's organization), never leak entity internals,
 * and keep `submittedData` (personal data) out of the lists.
 */
describe('AdminCertificatesService — request read paths', () => {
  let requestsRepo: { findAndCount: jest.Mock; findOne: jest.Mock; count: jest.Mock };
  let usersRepo: { findOne: jest.Mock };
  let accessLogService: { record: jest.Mock };
  let service: AdminCertificatesService;

  beforeEach(() => {
    process.env.ADMIN_CERTIFICATES_STORAGE_DIR = path.join(os.tmpdir(), 'dioteko-spec-storage');
    requestsRepo = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    };
    usersRepo = { findOne: jest.fn().mockResolvedValue({ id: 'staff-1', organizationId: 'org-1', accountStatus: 'active' }) };
    accessLogService = { record: jest.fn().mockResolvedValue({}) };
    const config = { get: jest.fn((_k: string, d?: unknown) => d) };

    const args = [
      requestsRepo,
      undefined, // refsRepository
      undefined, // organizationsRepository
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
    ];
    service = new (AdminCertificatesService as unknown as new (...a: unknown[]) => AdminCertificatesService)(...args);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('listMyRequests', () => {
    it("queries only the caller's rows, newest first with an id tiebreak, with the requested page", async () => {
      await service.listMyRequests('holder-1', { limit: 20, offset: 40 });

      expect(requestsRepo.findAndCount).toHaveBeenCalledWith({
        where: [{ holderUserId: 'holder-1' }],
        relations: { adminCertificateRef: { vc: true } },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 20,
        skip: 40,
      });
    });

    it('returns the explicit view and the total: price from the catalog, no submittedData, no entity internals', async () => {
      const expiresAt = new Date(Date.now() + 200 * DAY_MS);
      requestsRepo.findAndCount.mockResolvedValue([
        [
          makeRequest({
            status: AdminCertificateRequestStatus.ISSUED,
            paymentId: 'pay-1',
            adminCertificateRef: {
              externalReference: 'cert-uuid-1',
              vcId: 'vc-secret',
              subjectDidId: 'did-secret',
              vc: { status: VerifiableCredentialStatus.ACTIVE, expiresAt },
            },
          }),
        ],
        41,
      ]);

      const { requests, total } = await service.listMyRequests('holder-1', { limit: 20, offset: 0 });

      expect(total).toBe(41);
      expect(requests[0]).toEqual({
        id: 'req-1',
        certificateType: 'residence',
        status: AdminCertificateRequestStatus.ISSUED,
        priceSats: RESIDENCE_PRICE,
        paymentId: 'pay-1',
        decisionReason: null,
        certificateId: 'cert-uuid-1',
        expiresAt,
        validity: 'valid',
        createdAt: new Date('2026-10-10T10:00:00Z'),
        updatedAt: new Date('2026-10-10T10:05:00Z'),
      });
      expect(requests[0]).not.toHaveProperty('submittedData');
      expect(requests[0]).not.toHaveProperty('holderUserId');
      expect(requests[0]).not.toHaveProperty('organizationId');
    });

    it('gives certificateId/validity null before issuance and priceSats null for a type no longer in the catalog', async () => {
      requestsRepo.findAndCount.mockResolvedValue([[makeRequest({ certificateType: 'legacy-type' })], 1]);

      const {
        requests: [item],
      } = await service.listMyRequests('holder-1', { limit: 20, offset: 0 });

      expect(item.certificateId).toBeNull();
      expect(item.validity).toBeNull();
      expect(item.expiresAt).toBeNull();
      expect(item.priceSats).toBeNull();
    });

    it('does not widen the filter for an issuer or admin: the service only ever receives the caller id', async () => {
      await service.listMyRequests('issuer-1', { limit: 20, offset: 0 });

      expect(requestsRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: [{ holderUserId: 'issuer-1' }] }),
      );
    });

    it('narrows by status without ever dropping the holder scope', async () => {
      await service.listMyRequests('holder-1', { limit: 20, offset: 0, status: [AdminCertificateRequestStatus.ISSUED] });

      expect(requestsRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: [{ holderUserId: 'holder-1', status: In([AdminCertificateRequestStatus.ISSUED]) }] }),
      );
    });

    it('accepts several statuses (the mobile "Pending" filter) as an IN condition', async () => {
      const statuses = [AdminCertificateRequestStatus.PENDING, AdminCertificateRequestStatus.AWAITING_PAYMENT, AdminCertificateRequestStatus.PAID];
      await service.listMyRequests('holder-1', { limit: 20, offset: 0, status: statuses });

      expect(requestsRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: [{ holderUserId: 'holder-1', status: In(statuses) }] }),
      );
    });

    it('keeps the holder scope (and the status) in EVERY OR-ed fragment of a validity filter', async () => {
      await service.listMyRequests('holder-1', {
        limit: 20,
        offset: 0,
        status: [AdminCertificateRequestStatus.ISSUED],
        validity: 'expired',
      });

      const { where } = requestsRepo.findAndCount.mock.calls[0][0] as { where: Record<string, unknown>[] };
      expect(where).toHaveLength(2); // credential flagged expired OR active but past expiresAt
      for (const fragment of where) {
        expect(fragment).toMatchObject({ holderUserId: 'holder-1', status: In([AdminCertificateRequestStatus.ISSUED]) });
        expect(fragment).toHaveProperty('adminCertificateRef.vc');
      }
    });

    it('builds a single credential condition for revoked', async () => {
      await service.listMyRequests('holder-1', { limit: 20, offset: 0, validity: 'revoked' });

      const { where } = requestsRepo.findAndCount.mock.calls[0][0] as { where: Record<string, unknown>[] };
      expect(where).toEqual([
        { holderUserId: 'holder-1', adminCertificateRef: { vc: { status: VerifiableCredentialStatus.REVOKED } } },
      ]);
    });
  });

  describe('getMyRequestStats', () => {
    it('counts every status and validity scoped to the caller, and sums the total', async () => {
      requestsRepo.count.mockImplementation(async ({ where }: { where: Record<string, unknown> | Record<string, unknown>[] }) => {
        const first = Array.isArray(where) ? where[0] : where;
        if (first.status === AdminCertificateRequestStatus.ISSUED) return 3;
        if (first.status === AdminCertificateRequestStatus.PENDING) return 2;
        return 0;
      });

      const stats = await service.getMyRequestStats('holder-1');

      expect(stats.total).toBe(5);
      expect(stats.byStatus).toEqual({
        pending: 2,
        accepted: 0,
        needs_info: 0,
        awaiting_payment: 0,
        paid: 0,
        issuing: 0,
        issued: 3,
        rejected: 0,
      });
      expect(Object.keys(stats.byValidity).sort()).toEqual(['expired', 'expiring_soon', 'revoked', 'valid']);
      for (const [{ where }] of requestsRepo.count.mock.calls as [{ where: Record<string, unknown> | Record<string, unknown>[] }][]) {
        const fragments = Array.isArray(where) ? where : [where];
        for (const fragment of fragments) {
          expect(fragment).toMatchObject({ holderUserId: 'holder-1' });
        }
      }
    });
  });

  describe('getMyRequest', () => {
    it('looks the request up by id AND owner, and returns the view with submittedData', async () => {
      requestsRepo.findOne.mockResolvedValue(makeRequest());

      const view = await service.getMyRequest('req-1', 'holder-1');

      expect(requestsRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'req-1', holderUserId: 'holder-1' },
        relations: { adminCertificateRef: { vc: true } },
      });
      expect(view.submittedData).toEqual({ fullName: 'Awa Ndiaye' });
      expect(view.priceSats).toBe(RESIDENCE_PRICE);
      expect(view).not.toHaveProperty('holderUserId');
    });

    it('answers 404 when the request is not found for this caller (another holder, an issuer, or an unknown id)', async () => {
      requestsRepo.findOne.mockResolvedValue(null);

      await expect(service.getMyRequest('req-1', 'holder-2')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getMyRequest('req-1', 'issuer-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listOrganizationRequests (staff)', () => {
    it("scopes to the organization read from the caller's user row, not to anything sent by the client", async () => {
      await service.listOrganizationRequests('staff-1', { limit: 20, offset: 0, status: [AdminCertificateRequestStatus.PAID] });

      expect(usersRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'staff-1' } }));
      expect(requestsRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [{ organizationId: 'org-1', status: In([AdminCertificateRequestStatus.PAID]) }],
        }),
      );
    });

    it('refuses a staff account that is not attached to an organization (no query on requests)', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'staff-2', organizationId: null, accountStatus: 'active' });

      await expect(service.listOrganizationRequests('staff-2', { limit: 20, offset: 0 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(requestsRepo.findAndCount).not.toHaveBeenCalled();
    });

    it('refuses a suspended staff account even if its token still carries the issuer role', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'staff-3', organizationId: 'org-1', accountStatus: 'suspended' });

      await expect(service.getOrganizationRequest('req-1', 'staff-3')).rejects.toBeInstanceOf(ForbiddenException);
      expect(requestsRepo.findOne).not.toHaveBeenCalled();
      expect(accessLogService.record).not.toHaveBeenCalled();
    });

    it('refuses an empty ownership scope instead of widening the query', async () => {
      await expect(service.listMyRequests('', { limit: 20, offset: 0 })).rejects.toBeInstanceOf(ForbiddenException);
      expect(requestsRepo.findAndCount).not.toHaveBeenCalled();
    });

    it('returns a minimal projection: no submittedData, no paymentId, no holder identity', async () => {
      requestsRepo.findAndCount.mockResolvedValue([[makeRequest({ paymentId: 'pay-1' })], 1]);

      const { requests, total } = await service.listOrganizationRequests('staff-1', { limit: 20, offset: 0 });

      expect(total).toBe(1);
      expect(requests[0]).not.toHaveProperty('submittedData');
      expect(requests[0]).not.toHaveProperty('paymentId');
      expect(requests[0]).not.toHaveProperty('holderUserId');
      expect(requests[0].id).toBe('req-1');
    });
  });

  describe('getOrganizationRequest (staff)', () => {
    it('looks the request up by id AND organization, returns submittedData and writes an access log', async () => {
      requestsRepo.findOne.mockResolvedValue(makeRequest());

      const view = await service.getOrganizationRequest('req-1', 'staff-1');

      expect(requestsRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'req-1', organizationId: 'org-1' },
        relations: { adminCertificateRef: { vc: true } },
      });
      expect(view.submittedData).toEqual({ fullName: 'Awa Ndiaye' });
      expect(view).not.toHaveProperty('paymentId');
      expect(accessLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: AccessLogActorType.ISSUER_ORGANIZATION,
          actorOrganizationId: 'org-1',
          actorUserId: 'staff-1',
          resourceType: 'admin_certificate_request',
          resourceId: 'req-1',
          action: AccessLogAction.READ,
          metadata: { holderUserId: 'holder-1', certificateType: 'residence' },
        }),
      );
    });

    it('answers 404 (and logs nothing) for a request of another organization or an unknown id', async () => {
      requestsRepo.findOne.mockResolvedValue(null);

      await expect(service.getOrganizationRequest('req-9', 'staff-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(accessLogService.record).not.toHaveBeenCalled();
    });
  });
});

describe('computeValidity', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  const inDays = (days: number) => new Date(now.getTime() + days * DAY_MS);

  it('is null when nothing is issued', () => {
    expect(computeValidity(null, now)).toBeNull();
  });

  it('is revoked whatever the expiry says', () => {
    expect(computeValidity({ status: VerifiableCredentialStatus.REVOKED, expiresAt: inDays(300) }, now)).toBe('revoked');
    expect(computeValidity({ status: VerifiableCredentialStatus.REVOKED, expiresAt: inDays(-5) }, now)).toBe('revoked');
  });

  it('is expired when flagged expired or when expiresAt is in the past', () => {
    expect(computeValidity({ status: VerifiableCredentialStatus.EXPIRED, expiresAt: inDays(300) }, now)).toBe('expired');
    expect(computeValidity({ status: VerifiableCredentialStatus.ACTIVE, expiresAt: inDays(-1) }, now)).toBe('expired');
  });

  it('is expiring_soon within 30 days and valid beyond (or without expiry)', () => {
    expect(computeValidity({ status: VerifiableCredentialStatus.ACTIVE, expiresAt: inDays(10) }, now)).toBe('expiring_soon');
    expect(computeValidity({ status: VerifiableCredentialStatus.ACTIVE, expiresAt: inDays(30) }, now)).toBe('expiring_soon');
    expect(computeValidity({ status: VerifiableCredentialStatus.ACTIVE, expiresAt: inDays(31) }, now)).toBe('valid');
    expect(computeValidity({ status: VerifiableCredentialStatus.ACTIVE, expiresAt: null }, now)).toBe('valid');
  });
});
