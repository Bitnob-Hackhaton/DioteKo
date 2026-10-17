// `AdminCertificatesService` transitively imports the DID/VC services, which
// import `jose` (ESM) — unloadable under ts-jest/CommonJS. None of the payout
// paths touch it, so a bare stub is enough.
jest.mock('jose', () => ({
  SignJWT: class {},
  jwtVerify: jest.fn(),
  importPKCS8: jest.fn(),
  importSPKI: jest.fn(),
}));

import * as os from 'os';
import * as path from 'path';
import { BadGatewayException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { BitnobApiError } from '../../bitnob/services/bitnob-http-client.service';
import { AccountStatus } from '../../identity/entities/user.entity';
import { AdminCertificatesService } from './admin-certificates.service';

/**
 * Focus: the risky Bitnob-payout orchestration paths on
 * `AdminCertificatesService` — 409 pre-check, the B2 quote-failure recovery,
 * the N1 atomic finalize transition, and the production finalize gate.
 */
describe('AdminCertificatesService — Bitnob payout orchestration', () => {
  const REF = { id: 'ref-1', organizationId: 'org-1', subjectDidId: 'did-1', externalReference: 'CERT-1' };

  const ACTOR = 'issuer-1';

  let refsRepo: { findOne: jest.Mock };
  let usersRepo: { findOne: jest.Mock };
  let requestsRepo: { count: jest.Mock };
  let paymentsRepo: { findOne: jest.Mock; save: jest.Mock };
  let payoutsRepo: { findOne: jest.Mock; save: jest.Mock; update: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let config: { get: jest.Mock };
  let accessLog: { record: jest.Mock };
  let bitnob: {
    createQuote: jest.Mock;
    initializePayout: jest.Mock;
    finalizePayout: jest.Mock;
    getPayout: jest.Mock;
  };
  let service: AdminCertificatesService;

  beforeEach(() => {
    process.env.ADMIN_CERTIFICATES_STORAGE_DIR = path.join(os.tmpdir(), 'dioteko-spec-storage');

    // Honours the WHERE the service builds: the certificate is only found inside the organization asked for.
    refsRepo = {
      findOne: jest.fn(async ({ where }: { where: { externalReference: string; organizationId: string } }) =>
        where.externalReference === REF.externalReference && where.organizationId === REF.organizationId ? REF : null,
      ),
    };
    requestsRepo = { count: jest.fn().mockResolvedValue(0) };
    usersRepo = {
      findOne: jest.fn().mockResolvedValue({ id: ACTOR, organizationId: 'org-1', accountStatus: AccountStatus.ACTIVE }),
    };
    paymentsRepo = { findOne: jest.fn().mockResolvedValue(null), save: jest.fn(async (x) => x) };
    payoutsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (x) => x),
      update: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => unknown) =>
        cb({
          create: (_entity: unknown, obj: Record<string, unknown>) => ({ id: 'row-1', ...obj }),
          save: async (x: unknown) => x,
        }),
      ),
    };
    const configValues: Record<string, string> = {
      'bitnob.environment': 'sandbox',
      'bitnob.payoutBeneficiary.accountNumber': '0123456789',
      'bitnob.payoutBeneficiary.accountName': 'TEST ACCOUNT HOLDER',
      'bitnob.payoutBeneficiary.bankCode': '000014',
      'bitnob.payoutBeneficiary.country': 'NG',
    };
    config = { get: jest.fn((k: string, d?: unknown) => configValues[k] ?? d) };
    accessLog = { record: jest.fn().mockResolvedValue(undefined) };
    bitnob = {
      createQuote: jest.fn(),
      initializePayout: jest.fn(),
      finalizePayout: jest.fn(),
      getPayout: jest.fn(),
    };

    // The payout methods only touch 7 of the 15 constructor deps; the rest
    // are irrelevant here and passed as `undefined`.
    const args = [
      requestsRepo, // requestsRepository (only `count`, for the simulated-payment refusal)
      refsRepo,
      undefined, // organizationsRepository
      paymentsRepo,
      payoutsRepo,
      dataSource,
      undefined, // lightningInvoicesService
      undefined, // didService
      undefined, // credentialIssuanceService
      undefined, // credentialVerificationService
      undefined, // certificateAnchorService
      undefined, // certificatePdfService
      config,
      accessLog,
      bitnob,
      undefined, // bitnobLightningService
      undefined, // bitnobInvoiceSettlementService
      usersRepo,
    ];
    service = new (AdminCertificatesService as unknown as new (...a: unknown[]) => AdminCertificatesService)(...args);
  });

  const dto = { settlementAmount: '500', toCurrency: 'NGN', country: 'NG' } as never;

  describe('createBitnobPayoutForCertificate', () => {
    it('409s when a still-recoverable payout already exists (pre-check)', async () => {
      payoutsRepo.findOne.mockResolvedValue({ id: 'existing', status: 'initiated' });

      await expect(service.createBitnobPayoutForCertificate('CERT-1', dto, ACTOR)).rejects.toBeInstanceOf(ConflictException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('409s (not 500) on the concurrent-race 23505 from inside the transaction', async () => {
      const violation = new QueryFailedError('insert', [], new Error('dup') as never);
      (violation as unknown as { code: string; constraint: string }).code = '23505';
      (violation as unknown as { code: string; constraint: string }).constraint = 'UQ_bitnob_payouts_active_cert';
      dataSource.transaction.mockRejectedValue(violation);

      await expect(service.createBitnobPayoutForCertificate('CERT-1', dto, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    });

    it('B2: marks the row "failed" when the quote step throws (does not brick the cert)', async () => {
      bitnob.createQuote.mockRejectedValue(new BitnobApiError('Bitnob API request failed: boom', 500, null));

      await expect(service.createBitnobPayoutForCertificate('CERT-1', dto, ACTOR)).rejects.toBeInstanceOf(BitnobApiError);

      const statuses = payoutsRepo.save.mock.calls.map((c) => c[0].status);
      expect(statuses).toContain('failed');
    });
  });

  describe('organization scope', () => {
    it('looks the certificate up inside the actor organization (read from the DB)', async () => {
      payoutsRepo.findOne.mockResolvedValue({ id: 'existing', status: 'initiated' });

      await expect(service.createBitnobPayoutForCertificate('CERT-1', dto, ACTOR)).rejects.toBeInstanceOf(ConflictException);
      expect(refsRepo.findOne).toHaveBeenCalledWith({ where: { externalReference: 'CERT-1', organizationId: 'org-1' } });
    });

    it.each([
      ['create', (s: AdminCertificatesService) => s.createBitnobPayoutForCertificate('CERT-1', dto, ACTOR)],
      ['finalize', (s: AdminCertificatesService) => s.finalizeBitnobPayoutForCertificate('CERT-1', ACTOR)],
      ['reconcile', (s: AdminCertificatesService) => s.reconcileBitnobPayoutForCertificate('CERT-1', ACTOR)],
    ])('%s: a certificate of another organization answers 404, with no payout read and no Bitnob call', async (_name, call) => {
      usersRepo.findOne.mockResolvedValue({ id: ACTOR, organizationId: 'org-2', accountStatus: AccountStatus.ACTIVE });

      await expect(call(service)).rejects.toBeInstanceOf(NotFoundException);
      expect(payoutsRepo.findOne).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(bitnob.createQuote).not.toHaveBeenCalled();
      expect(bitnob.getPayout).not.toHaveBeenCalled();
      expect(bitnob.finalizePayout).not.toHaveBeenCalled();
    });

    it('403s a suspended staff account before looking at the certificate', async () => {
      usersRepo.findOne.mockResolvedValue({ id: ACTOR, organizationId: 'org-1', accountStatus: AccountStatus.SUSPENDED });

      await expect(service.reconcileBitnobPayoutForCertificate('CERT-1', ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(refsRepo.findOne).not.toHaveBeenCalled();
    });

    it('attributes a terminal payout to the staff member who triggered it in the audit log', async () => {
      payoutsRepo.findOne.mockResolvedValue({
        id: 'row-1',
        status: 'processing',
        bitnobPayoutId: 'bp-1',
        organizationId: 'org-1',
        reference: 'dkpayout_row-1',
      });
      bitnob.getPayout.mockResolvedValue({ status: 'COMPLETED' });

      await service.reconcileBitnobPayoutForCertificate('CERT-1', ACTOR);

      expect(accessLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: ACTOR, actorOrganizationId: 'org-1', resourceType: 'bitnob_payout' }),
      );
    });

    it('403s a staff account without organization before looking at the certificate', async () => {
      usersRepo.findOne.mockResolvedValue({ id: ACTOR, organizationId: null, accountStatus: AccountStatus.ACTIVE });

      await expect(service.finalizeBitnobPayoutForCertificate('CERT-1', ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(refsRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('finalizeBitnobPayoutForCertificate', () => {
    it('N1: 409s when the atomic initiated -> finalizing swap affects 0 rows', async () => {
      payoutsRepo.findOne.mockResolvedValue({
        id: 'row-1',
        status: 'processing',
        bitnobPayoutId: 'bp-1',
        quoteId: 'QT2_1',
      });
      payoutsRepo.update.mockResolvedValue({ affected: 0 });

      await expect(service.finalizeBitnobPayoutForCertificate('CERT-1', ACTOR)).rejects.toBeInstanceOf(ConflictException);
      expect(bitnob.getPayout).not.toHaveBeenCalled();
      expect(bitnob.finalizePayout).not.toHaveBeenCalled();
    });

    it('reverts the row to "initiated" and rethrows when finalize is blocked in production', async () => {
      payoutsRepo.findOne.mockResolvedValue({
        id: 'row-1',
        status: 'initiated',
        bitnobPayoutId: 'bp-1',
        quoteId: 'QT2_1',
        reference: 'dkpayout_row-1',
      });
      payoutsRepo.update.mockResolvedValue({ affected: 1 });
      bitnob.getPayout.mockResolvedValue({ status: 'INITIATED' });
      bitnob.finalizePayout.mockRejectedValue(new ForbiddenException('disabled in production'));

      await expect(service.finalizeBitnobPayoutForCertificate('CERT-1', ACTOR)).rejects.toBeInstanceOf(ForbiddenException);

      const lastSave = payoutsRepo.save.mock.calls.at(-1)?.[0];
      expect(lastSave.status).toBe('initiated');
    });

    it('disburses and moves to "processing" when it wins the swap and remote is INITIATED', async () => {
      payoutsRepo.findOne.mockResolvedValue({
        id: 'row-1',
        status: 'initiated',
        bitnobPayoutId: 'bp-1',
        quoteId: 'QT2_1',
        reference: 'dkpayout_row-1',
      });
      payoutsRepo.update.mockResolvedValue({ affected: 1 });
      bitnob.getPayout.mockResolvedValue({ status: 'INITIATED' });
      bitnob.finalizePayout.mockResolvedValue({ status: 'PROCESSING' });

      const res = await service.finalizeBitnobPayoutForCertificate('CERT-1', ACTOR);

      expect(bitnob.finalizePayout).toHaveBeenCalledWith('QT2_1');
      expect(res.payout.status).toBe('processing');
    });

    it('maps a raw Bitnob finalize rejection to 502 and reverts the row to "initiated"', async () => {
      payoutsRepo.findOne.mockResolvedValue({
        id: 'row-1',
        status: 'initiated',
        bitnobPayoutId: 'bp-1',
        quoteId: 'QT2_1',
        reference: 'dkpayout_row-1',
      });
      payoutsRepo.update.mockResolvedValue({ affected: 1 });
      bitnob.getPayout.mockResolvedValue({ status: 'INITIATED' });
      bitnob.finalizePayout.mockRejectedValue(
        new BitnobApiError('Bitnob API request failed: Request failed with status code 422', 422, null),
      );

      await expect(service.finalizeBitnobPayoutForCertificate('CERT-1', ACTOR)).rejects.toBeInstanceOf(BadGatewayException);
      const lastSave = payoutsRepo.save.mock.calls.at(-1)?.[0];
      expect(lastSave.status).toBe('initiated');
    });
  });
});
