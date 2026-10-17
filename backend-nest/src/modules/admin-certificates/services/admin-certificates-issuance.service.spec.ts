// `AdminCertificatesService` transitively imports the DID/VC services, which import `jose` (ESM) — unloadable
// under ts-jest/CommonJS. The orchestration under test does not touch it, so a bare stub is enough.
jest.mock('jose', () => ({
  SignJWT: class {},
  jwtVerify: jest.fn(),
  importPKCS8: jest.fn(),
  importSPKI: jest.fn(),
}));

import * as os from 'os';
import * as path from 'path';
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { LessThan } from 'typeorm';
import { AdminCertificateRequestStatus } from '../entities/admin-certificate-request.entity';
import { getCertificateTypeDefinition } from '../admin-certificates.constants';
import { LightningInvoiceStatus, LightningProvider } from '../../lightning/entities/lightning-invoice.entity';
import { PaymentStatus } from '../../lightning/entities/payment.entity';
import { AdminCertificatesService } from './admin-certificates.service';

const S = AdminCertificateRequestStatus;
const PRICE = getCertificateTypeDefinition('residence')!.priceSats;
const HOLDER = { userId: 'holder-1', roles: ['holder'] };

const makeRequest = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  holderUserId: 'holder-1',
  organizationId: 'org-1',
  certificateType: 'residence',
  submittedData: { fullName: 'Awa Ndiaye' },
  status: S.AWAITING_PAYMENT,
  paymentId: 'pay-1',
  paymentSimulated: false,
  ...over,
});

const makePayment = (over: Record<string, unknown> = {}) => ({
  id: 'pay-1',
  purposeType: 'admin_certificate_request',
  purposeId: 'req-1',
  amountSats: PRICE,
  status: PaymentStatus.PAID,
  ...over,
});

const makeInvoice = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  provider: LightningProvider.BITNOB,
  amountSats: PRICE,
  status: LightningInvoiceStatus.PAID,
  ...over,
});

/**
 * Automatic generation (flow B, lot 3): the paid-callback, its safety checks, the atomic claims, the resume pass
 * and the dev-only payment simulation. The generation itself (`performIssuance`) is stubbed: it is covered by the
 * manual `issue` tests; here only the orchestration around it matters.
 */
describe('AdminCertificatesService — automatic generation', () => {
  let requestsRepo: { findOne: jest.Mock; find: jest.Mock; update: jest.Mock; count: jest.Mock };
  let paymentsRepo: { findOne: jest.Mock };
  let lightning: { onInvoicePaid: jest.Mock; markPaid: jest.Mock };
  let config: Record<string, unknown>;
  let service: AdminCertificatesService;
  let issue: jest.SpyInstance;
  let claimAffected: number;

  const build = () => {
    const configService = { get: jest.fn((key: string, fallback?: unknown) => (key in config ? config[key] : fallback)) };
    const args = [
      requestsRepo,
      undefined, // refsRepository
      undefined, // organizationsRepository
      paymentsRepo,
      undefined, // bitnobPayoutsRepository
      undefined, // dataSource
      lightning,
      undefined, // didService
      undefined, // credentialIssuanceService
      undefined, // credentialVerificationService
      undefined, // certificateAnchorService
      undefined, // certificatePdfService
      configService,
      undefined, // accessLogService
      undefined, // bitnobPayoutsService
      undefined, // bitnobLightningService
      undefined, // bitnobInvoiceSettlementService
      undefined, // usersRepository
    ];
    service = new (AdminCertificatesService as unknown as new (...a: unknown[]) => AdminCertificatesService)(...args);
    issue = jest
      .spyOn(service as unknown as { performIssuance: () => Promise<unknown> }, 'performIssuance')
      .mockResolvedValue({ certificateId: 'cert-1' });
  };

  /** The update calls whose payload sets this status. */
  const updatesTo = (status: string) =>
    requestsRepo.update.mock.calls.filter(([, patch]) => (patch as { status?: string }).status === status);

  beforeEach(() => {
    process.env.ADMIN_CERTIFICATES_STORAGE_DIR = path.join(os.tmpdir(), 'dioteko-spec-storage');
    claimAffected = 1;
    requestsRepo = {
      findOne: jest.fn().mockResolvedValue(makeRequest()),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn(async () => ({ affected: claimAffected })),
      count: jest.fn().mockResolvedValue(0),
    };
    paymentsRepo = { findOne: jest.fn().mockResolvedValue(makePayment()) };
    lightning = { onInvoicePaid: jest.fn(), markPaid: jest.fn().mockResolvedValue(undefined) };
    config = { nodeEnv: 'development' };
    build();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('handleInvoicePaid', () => {
    it('promotes awaiting_payment to paid, claims with a token and generates the certificate', async () => {
      await service.handleInvoicePaid(makeInvoice() as never);

      expect(updatesTo(S.PAID)).toHaveLength(1);
      const claim = updatesTo(S.ISSUING)[0];
      expect(claim[0]).toEqual({ id: 'req-1', status: S.PAID });
      expect((claim[1] as { issuingToken: string }).issuingToken).toEqual(expect.any(String));
      expect(issue).toHaveBeenCalledTimes(1);
      expect(issue).toHaveBeenCalledWith(expect.objectContaining({ id: 'req-1' }), (claim[1] as { issuingToken: string }).issuingToken);
    });

    it('ignores an invoice that is not a certificate payment', async () => {
      paymentsRepo.findOne.mockResolvedValue(null);

      await service.handleInvoicePaid(makeInvoice() as never);

      expect(requestsRepo.update).not.toHaveBeenCalled();
      expect(issue).not.toHaveBeenCalled();
    });

    it('two concurrent notifications generate once: the loser of the claim does nothing', async () => {
      let first = true;
      requestsRepo.update.mockImplementation(async (_where: unknown, patch: { status?: string }) => ({
        affected: patch.status === S.ISSUING ? (first ? ((first = false), 1) : 0) : 1,
      }));

      await Promise.all([service.handleInvoicePaid(makeInvoice() as never), service.handleInvoicePaid(makeInvoice() as never)]);

      expect(issue).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['the request points at another payment', { paymentId: 'pay-other' }, {}, {}],
      ['the request is missing', null, {}, {}],
      ['the payment belongs to another request', {}, { purposeId: 'req-other' }, {}],
    ])('PAID_UNLINKED: %s -> nothing issued, error logged', async (_label, requestOver, paymentOver, invoiceOver) => {
      requestsRepo.findOne.mockResolvedValue(requestOver === null ? null : makeRequest(requestOver as Record<string, unknown>));
      paymentsRepo.findOne.mockResolvedValue(makePayment(paymentOver));
      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      await service.handleInvoicePaid(makeInvoice(invoiceOver) as never);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('PAID_UNLINKED'));
      expect(requestsRepo.update).not.toHaveBeenCalled();
      expect(issue).not.toHaveBeenCalled();
    });

    it.each([S.ACCEPTED, S.REJECTED, S.ISSUING, S.ISSUED, S.PENDING])(
      'does nothing for a request that is %s',
      async (status) => {
        requestsRepo.findOne.mockResolvedValue(makeRequest({ status }));

        await service.handleInvoicePaid(makeInvoice() as never);

        expect(requestsRepo.update).not.toHaveBeenCalled();
        expect(issue).not.toHaveBeenCalled();
      },
    );

    it('AMOUNT_MISMATCH: an invoice or payment below the catalog price issues nothing', async () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      await service.handleInvoicePaid(makeInvoice({ amountSats: PRICE - 1 }) as never);
      paymentsRepo.findOne.mockResolvedValue(makePayment({ amountSats: 1 }));
      await service.handleInvoicePaid(makeInvoice() as never);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('AMOUNT_MISMATCH'));
      expect(requestsRepo.update).not.toHaveBeenCalled();
      expect(issue).not.toHaveBeenCalled();
    });

    it('PROVIDER_MISMATCH: a historic (non-Bitnob) invoice issues nothing', async () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      await service.handleInvoicePaid(makeInvoice({ provider: LightningProvider.LNBITS }) as never);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('PROVIDER_MISMATCH'));
      expect(issue).not.toHaveBeenCalled();
    });

    it('a failed generation gives the claim back (conditional on its own token) and never throws', async () => {
      issue.mockRejectedValue(new Error('pdf exploded'));
      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      await expect(service.handleInvoicePaid(makeInvoice() as never)).resolves.toBeUndefined();

      const token = (updatesTo(S.ISSUING)[0][1] as { issuingToken: string }).issuingToken;
      const release = updatesTo(S.PAID).find(([, patch]) => (patch as { issuingToken?: null }).issuingToken === null);
      expect(release?.[0]).toEqual({ id: 'req-1', status: S.ISSUING, issuingToken: token });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('startIssuance FAILED'));
      expect(errorSpy).toHaveBeenCalledWith(expect.not.stringContaining('pdf exploded'));
    });
  });

  describe('paid-callback registration', () => {
    it('subscribes to the Lightning ledger at module init', () => {
      service.onModuleInit();
      expect(lightning.onInvoicePaid).toHaveBeenCalledTimes(1);
      service.onModuleDestroy();
    });

    it('does not start the resume timer in NODE_ENV=test', () => {
      config.nodeEnv = 'test';
      service.onModuleInit();
      expect((service as unknown as { resumeTimer: unknown }).resumeTimer).toBeNull();
    });
  });

  describe('free certificate types (price 0)', () => {
    it('generates right after acceptance, from accepted, without any payment', () => {
      const definition = getCertificateTypeDefinition('birth')!;
      const original = definition.priceSats;
      definition.priceSats = 0;
      try {
        const start = jest.spyOn(service as unknown as { startIssuance: () => Promise<void> }, 'startIssuance').mockResolvedValue();
        (service as unknown as { startFreeIssuanceIfNeeded: (...a: unknown[]) => void }).startFreeIssuanceIfNeeded('req-1', 'birth', S.ACCEPTED);
        expect(start).toHaveBeenCalledWith('req-1', S.ACCEPTED);
      } finally {
        definition.priceSats = original;
      }
    });

    it('does not generate for a priced type or a request that still needs review', () => {
      const start = jest.spyOn(service as unknown as { startIssuance: () => Promise<void> }, 'startIssuance').mockResolvedValue();
      const helper = (service as unknown as { startFreeIssuanceIfNeeded: (...a: unknown[]) => void }).startFreeIssuanceIfNeeded.bind(service);

      helper('req-1', 'birth', S.ACCEPTED); // priced
      helper('req-1', 'residence', S.PENDING);

      expect(start).not.toHaveBeenCalled();
    });
  });

  describe('resumeStuckRequests', () => {
    it('re-runs the SAME checks for an awaiting request whose payment is already paid', async () => {
      requestsRepo.find.mockResolvedValueOnce([
        makeRequest({ payment: { ...makePayment({ amountSats: 1 }), lightningInvoice: makeInvoice() } }),
      ]);
      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      await service.resumeStuckRequests();

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('AMOUNT_MISMATCH'));
      expect(issue).not.toHaveBeenCalled();
    });

    it('resumes a paid request through the atomic claim', async () => {
      requestsRepo.find
        .mockResolvedValueOnce([]) // awaiting with paid payment
        .mockResolvedValueOnce([
          makeRequest({ status: S.PAID, payment: { ...makePayment(), lightningInvoice: makeInvoice() } }),
        ]);

      const { resumed } = await service.resumeStuckRequests();

      expect(resumed).toBe(1);
      expect(issue).toHaveBeenCalledTimes(1);
    });

    it('takes over an abandoned issuing with a NEW token, only if it is still stale', async () => {
      requestsRepo.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeRequest({ status: S.ISSUING })]);

      await service.resumeStuckRequests();

      const staleFind = requestsRepo.find.mock.calls[2][0] as { where: { updatedAt: unknown } };
      expect(staleFind.where.updatedAt).toEqual(LessThan(expect.any(Date)));
      const takeover = requestsRepo.update.mock.calls[0];
      expect(takeover[0]).toMatchObject({ id: 'req-1', status: S.ISSUING });
      expect((takeover[0] as { updatedAt: unknown }).updatedAt).toBeDefined();
      expect((takeover[1] as { issuingToken: string }).issuingToken).toEqual(expect.any(String));
      expect(issue).toHaveBeenCalledWith(expect.anything(), (takeover[1] as { issuingToken: string }).issuingToken);
    });

    it('skips a stale issuing that another pass already took over (claim lost)', async () => {
      claimAffected = 0;
      requestsRepo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([makeRequest({ status: S.ISSUING })]);

      await service.resumeStuckRequests();

      expect(issue).not.toHaveBeenCalled();
    });

    it('never throws and keeps going when the lookup fails', async () => {
      requestsRepo.find.mockRejectedValue(new Error('db down'));

      await expect(service.resumeStuckRequests()).resolves.toEqual({ resumed: 0 });
    });
  });

  describe('simulatePayment', () => {
    const awaiting = () => {
      requestsRepo.findOne.mockResolvedValue(makeRequest());
      paymentsRepo.findOne.mockResolvedValue({
        ...makePayment({ status: PaymentStatus.PENDING }),
        lightningInvoice: makeInvoice({ status: LightningInvoiceStatus.PENDING }),
      });
    };
    const enable = () => {
      config['payments.simulation'] = true;
      config['bitnob.environment'] = 'sandbox';
    };

    it('answers 404 when the flag is off, without touching anything', async () => {
      awaiting();

      await expect(service.simulatePayment('req-1', HOLDER)).rejects.toBeInstanceOf(NotFoundException);
      expect(requestsRepo.findOne).not.toHaveBeenCalled();
      expect(lightning.markPaid).not.toHaveBeenCalled();
    });

    it.each([
      ['production NODE_ENV', { nodeEnv: 'production' }],
      ['a non-sandbox Bitnob environment', { 'bitnob.environment': 'production' }],
      ['an unset Bitnob environment', { 'bitnob.environment': undefined }],
    ])('answers 404 even with the flag on when the environment is %s (re-checked on every call)', async (_l, over) => {
      enable();
      Object.assign(config, over);
      awaiting();

      await expect(service.simulatePayment('req-1', HOLDER)).rejects.toBeInstanceOf(NotFoundException);
      expect(lightning.markPaid).not.toHaveBeenCalled();
    });

    it('marks the request as simulated THEN applies the payment through the real markPaid', async () => {
      enable();
      awaiting();

      await service.simulatePayment('req-1', HOLDER);

      expect(requestsRepo.update).toHaveBeenCalledWith(
        { id: 'req-1', status: S.AWAITING_PAYMENT },
        { paymentSimulated: true },
      );
      expect(lightning.markPaid).toHaveBeenCalledTimes(1);
      expect(requestsRepo.update.mock.invocationCallOrder[0]).toBeLessThan(lightning.markPaid.mock.invocationCallOrder[0]);
    });

    it('is holder-only: a request of someone else answers 404 (staff included)', async () => {
      enable();
      awaiting();
      requestsRepo.findOne.mockResolvedValue(null); // the holder id is in the WHERE

      await expect(service.simulatePayment('req-1', { userId: 'issuer-1', roles: ['issuer'] })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(lightning.markPaid).not.toHaveBeenCalled();
    });

    it.each([
      ['an expired invoice', { status: PaymentStatus.PENDING }, { status: LightningInvoiceStatus.EXPIRED }],
      ['a failed invoice', { status: PaymentStatus.FAILED }, { status: LightningInvoiceStatus.FAILED }],
      ['a historic (non-Bitnob) invoice', { status: PaymentStatus.PENDING }, { status: LightningInvoiceStatus.PENDING, provider: LightningProvider.LNBITS }],
    ])('refuses %s: markPaid would flip it', async (_l, paymentOver, invoiceOver) => {
      enable();
      requestsRepo.findOne.mockResolvedValue(makeRequest());
      paymentsRepo.findOne.mockResolvedValue({ ...makePayment(paymentOver), lightningInvoice: makeInvoice(invoiceOver) });

      await expect(service.simulatePayment('req-1', HOLDER)).rejects.toBeInstanceOf(BadRequestException);
      expect(lightning.markPaid).not.toHaveBeenCalled();
    });

    it('refuses a request that is not awaiting payment', async () => {
      enable();
      requestsRepo.findOne.mockResolvedValue(makeRequest({ status: S.ACCEPTED, paymentId: null }));

      await expect(service.simulatePayment('req-1', HOLDER)).rejects.toBeInstanceOf(BadRequestException);
      expect(lightning.markPaid).not.toHaveBeenCalled();
    });
  });

  describe('manual issue keeps the same claim', () => {
    it('answers 409 when the automatic generation holds the claim', async () => {
      requestsRepo.findOne.mockResolvedValue(makeRequest({ status: S.PAID }));
      const staff = { userId: 'issuer-1', roles: ['issuer'] };
      const users = { findOne: jest.fn().mockResolvedValue({ id: 'issuer-1', organizationId: 'org-1', accountStatus: 'active' }) };
      (service as unknown as { usersRepository: unknown }).usersRepository = users;
      claimAffected = 0;

      await expect(service.issueForRequest('req-1', staff)).rejects.toBeInstanceOf(ConflictException);
      expect(issue).not.toHaveBeenCalled();
    });
  });
});
