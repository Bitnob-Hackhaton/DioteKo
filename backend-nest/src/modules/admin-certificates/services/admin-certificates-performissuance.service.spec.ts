// `AdminCertificatesService` transitively imports the DID/VC services, which import `jose` (ESM) — unloadable
// under ts-jest/CommonJS. The generation under test uses injected fakes, so a bare stub is enough.
jest.mock('jose', () => ({
  SignJWT: class {},
  jwtVerify: jest.fn(),
  importPKCS8: jest.fn(),
  importSPKI: jest.fn(),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { AdminCertificateRequestStatus } from '../entities/admin-certificate-request.entity';
import { getCertificateTypeDefinition } from '../admin-certificates.constants';
import { LightningInvoiceStatus, LightningProvider } from '../../lightning/entities/lightning-invoice.entity';
import { PaymentStatus } from '../../lightning/entities/payment.entity';
import { AdminCertificatesService } from './admin-certificates.service';

const S = AdminCertificateRequestStatus;
const PRICE = getCertificateTypeDefinition('residence')!.priceSats;

const makeRequest = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  holderUserId: 'holder-1',
  organizationId: 'org-1',
  certificateType: 'residence',
  submittedData: { fullName: 'Awa Ndiaye' },
  status: S.ISSUING,
  paymentId: 'pay-1',
  paymentSimulated: false,
  reviewedByUserId: 'staff-1',
  ...over,
});

/**
 * The generation itself (`performIssuance`) with fake collaborators: the simulated marker inside the signed
 * credential, the token-fenced final write, and the cleanup of an attempt that cannot be finished (a leftover
 * credential would stay verifiable = a second valid certificate for one request).
 */
describe('AdminCertificatesService — performIssuance (generation)', () => {
  let dir: string;
  let requestsRepo: { update: jest.Mock; findOne: jest.Mock; find: jest.Mock };
  let refsRepo: { save: jest.Mock; create: jest.Mock; delete: jest.Mock };
  let issuance: { issue: jest.Mock };
  let revocation: { revoke: jest.Mock; revokeActiveByMetadata: jest.Mock };
  let generatePdf: jest.Mock;
  let service: AdminCertificatesService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dioteko-issuance-'));
    process.env.ADMIN_CERTIFICATES_STORAGE_DIR = dir;
    requestsRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    refsRepo = {
      create: jest.fn((v: Record<string, unknown>) => v),
      save: jest.fn(async (v: Record<string, unknown>) => ({ id: 'ref-1', ...v })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    issuance = { issue: jest.fn().mockResolvedValue({ id: 'vc-1', hash: 'hash-1' }) };
    revocation = { revoke: jest.fn().mockResolvedValue({}), revokeActiveByMetadata: jest.fn().mockResolvedValue(0) };
    generatePdf = jest.fn().mockResolvedValue({ pdfBuffer: Buffer.from('%PDF') });
    const did = {
      findByController: jest.fn(async (user?: string) => ({ id: user ? 'did-sub' : 'did-iss', did: 'did:x' })),
      createDid: jest.fn(),
    };
    const args = [
      requestsRepo,
      refsRepo,
      { findOne: jest.fn().mockResolvedValue({ id: 'org-1' }) },
      undefined, // paymentsRepository
      undefined, // bitnobPayoutsRepository
      undefined, // dataSource
      undefined, // lightningInvoicesService
      did,
      issuance,
      undefined, // credentialVerificationService
      {
        createDocumentHash: jest.fn(() => 'fp'),
        anchorDocumentHash: jest.fn().mockResolvedValue({ txId: 'tx', network: 'testnet', timestamp: 't', blockHeight: 1 }),
      },
      { generatePdf },
      { get: jest.fn((_k: string, d?: unknown) => d) },
      undefined, // accessLogService
      undefined, // bitnobPayoutsService
      undefined, // bitnobLightningService
      undefined, // bitnobInvoiceSettlementService
      undefined, // usersRepository
      revocation,
    ];
    service = new (AdminCertificatesService as unknown as new (...a: unknown[]) => AdminCertificatesService)(...args);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (request = makeRequest(), token = 'tok-1') =>
    (service as unknown as { performIssuance: (r: unknown, t: string) => Promise<unknown> }).performIssuance(request, token);

  it('ends issued with a final write conditional on its own token', async () => {
    await run();

    expect(requestsRepo.update).toHaveBeenCalledWith(
      { id: 'req-1', status: S.ISSUING, issuingToken: 'tok-1' },
      expect.objectContaining({ status: S.ISSUED, adminCertificateRefId: 'ref-1', issuingToken: null }),
    );
    expect(revocation.revoke).not.toHaveBeenCalled();
  });

  it('puts simulatedPayment=true in the signed credential subject only for a simulated payment', async () => {
    await run(makeRequest({ paymentSimulated: true }));
    await run(makeRequest({ paymentSimulated: false }));

    expect(issuance.issue.mock.calls[0][0].credentialSubject).toEqual({ fullName: 'Awa Ndiaye', simulatedPayment: true });
    expect(issuance.issue.mock.calls[1][0].credentialSubject).toEqual({ fullName: 'Awa Ndiaye' });
  });

  it('marks the credential and the PDF as declared-not-verified only when no agent reviewed the request', async () => {
    await run(makeRequest({ reviewedByUserId: null }));
    await run(makeRequest({ reviewedByUserId: 'staff-1' }));

    expect(issuance.issue.mock.calls[0][0].credentialSubject).toEqual({ fullName: 'Awa Ndiaye', declaredNotVerified: true });
    expect(issuance.issue.mock.calls[1][0].credentialSubject).toEqual({ fullName: 'Awa Ndiaye' });
    expect(generatePdf.mock.calls[0][0].declaredNotVerified).toBe(true);
    expect(generatePdf.mock.calls[1][0].declaredNotVerified).toBe(false);
  });

  it('when the claim was lost: removes the PDF, deletes the reference, revokes the credential, and fails', async () => {
    requestsRepo.update.mockResolvedValue({ affected: 0 });

    await expect(run()).rejects.toBeInstanceOf(ConflictException);

    expect(refsRepo.delete).toHaveBeenCalledWith({ id: 'ref-1' });
    expect(revocation.revoke).toHaveBeenCalledWith('vc-1');
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('when the reference cannot be saved: removes the PDF and revokes the credential', async () => {
    refsRepo.save.mockRejectedValue(new Error('db down'));

    await expect(run()).rejects.toThrow('db down');

    expect(refsRepo.delete).not.toHaveBeenCalled();
    expect(revocation.revoke).toHaveBeenCalledWith('vc-1');
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('when the final write throws: discards the whole attempt too', async () => {
    requestsRepo.update.mockRejectedValue(new Error('db down'));

    await expect(run()).rejects.toThrow('db down');

    expect(refsRepo.delete).toHaveBeenCalledWith({ id: 'ref-1' });
    expect(revocation.revoke).toHaveBeenCalledWith('vc-1');
  });

  it('when the PDF cannot be rendered: revokes the credential it just signed and fails (no active orphan)', async () => {
    generatePdf.mockRejectedValue(new Error('renderer crashed'));

    await expect(run()).rejects.toThrow('renderer crashed');

    expect(revocation.revoke).toHaveBeenCalledWith('vc-1');
    expect(refsRepo.save).not.toHaveBeenCalled();
    expect(requestsRepo.update).not.toHaveBeenCalled();
  });

  it('when the PDF comes back empty: revokes the credential too', async () => {
    generatePdf.mockResolvedValue({ pdfBuffer: Buffer.alloc(0) });

    await expect(run()).rejects.toThrow('empty buffer');

    expect(revocation.revoke).toHaveBeenCalledWith('vc-1');
  });

  it('tags the credential with its requestId and retires earlier active ones BEFORE signing a new one', async () => {
    const order: string[] = [];
    revocation.revokeActiveByMetadata.mockImplementation(async () => {
      order.push('retire');
      return 1;
    });
    issuance.issue.mockImplementation(async () => {
      order.push('issue');
      return { id: 'vc-2', hash: 'hash-2' };
    });

    await run();

    expect(revocation.revokeActiveByMetadata).toHaveBeenCalledWith('requestId', 'req-1');
    expect(order).toEqual(['retire', 'issue']);
    expect(issuance.issue.mock.calls[0][0].metadata).toEqual({ requestId: 'req-1' });
  });

  it('a failed revocation is logged as ORPHAN and does not hide the original failure', async () => {
    requestsRepo.update.mockResolvedValue({ affected: 0 });
    revocation.revoke.mockRejectedValue(new Error('already revoked'));
    const errorSpy = jest.spyOn(Logger.prototype, 'error');

    await expect(run()).rejects.toBeInstanceOf(ConflictException);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ORPHAN'));
  });
});

describe('AdminCertificatesService — resume pass and invoicing edges', () => {
  let requestsRepo: { find: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let paymentsRepo: { findOne: jest.Mock };
  let service: AdminCertificatesService;
  let issue: jest.SpyInstance;

  beforeEach(() => {
    process.env.ADMIN_CERTIFICATES_STORAGE_DIR = path.join(os.tmpdir(), 'dioteko-spec-storage');
    requestsRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    paymentsRepo = { findOne: jest.fn() };
    const args = [
      requestsRepo,
      undefined,
      undefined,
      paymentsRepo,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { get: jest.fn((_k: string, d?: unknown) => d) },
    ];
    service = new (AdminCertificatesService as unknown as new (...a: unknown[]) => AdminCertificatesService)(...args);
    issue = jest
      .spyOn(service as unknown as { performIssuance: () => Promise<unknown> }, 'performIssuance')
      .mockResolvedValue({});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const payment = (over: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    purposeType: 'admin_certificate_request',
    purposeId: 'req-1',
    amountSats: PRICE,
    status: PaymentStatus.PAID,
    lightningInvoice: {
      id: 'inv-1',
      provider: LightningProvider.BITNOB,
      amountSats: PRICE,
      status: LightningInvoiceStatus.PAID,
    },
    ...over,
  });

  it('a paid request whose provider or amount does not check out is NOT generated by the resume pass', async () => {
    requestsRepo.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeRequest({ status: S.PAID, payment: payment({ amountSats: 1 }) }),
        makeRequest({ id: 'req-2', status: S.PAID, payment: payment({ purposeId: 'req-2', lightningInvoice: { id: 'i2', provider: LightningProvider.LNBITS, amountSats: PRICE } }) }),
      ]);

    await service.resumeStuckRequests();

    expect(issue).not.toHaveBeenCalled();
  });

  it('a paid request with no invoice at all is reported, not generated', async () => {
    requestsRepo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([makeRequest({ status: S.PAID, payment: null })]);
    const errorSpy = jest.spyOn(Logger.prototype, 'error');

    await service.resumeStuckRequests();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('PAID_UNLINKED'));
    expect(issue).not.toHaveBeenCalled();
  });

  it('one failing row does not stop the next ones, and the lookups run oldest first', async () => {
    const good = makeRequest({ id: 'req-2', status: S.PAID, payment: payment({ purposeId: 'req-2' }) });
    const bad = makeRequest({ status: S.PAID, payment: payment() });
    requestsRepo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([bad, good]);
    let calls = 0;
    requestsRepo.update.mockImplementation(async () => {
      if (calls++ === 0) throw new Error('db hiccup');
      return { affected: 1 };
    });
    requestsRepo.findOne.mockResolvedValue(good);

    await expect(service.resumeStuckRequests()).resolves.toBeDefined();

    expect(issue).toHaveBeenCalledTimes(1); // the second row still went through
    for (const [arg] of requestsRepo.find.mock.calls as [{ order: unknown }][]) {
      expect(arg.order).toEqual({ updatedAt: 'ASC' });
    }
  });

  it('refuses to invoice a free certificate type', async () => {
    const definition = getCertificateTypeDefinition('residence')!;
    const original = definition.priceSats;
    definition.priceSats = 0;
    requestsRepo.findOne.mockResolvedValue(makeRequest({ status: S.ACCEPTED, paymentId: null }));
    try {
      await expect(service.createInvoiceForRequest('req-1', { userId: 'holder-1', roles: ['holder'] })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(requestsRepo.update).not.toHaveBeenCalled();
    } finally {
      definition.priceSats = original;
    }
  });
});
