// `AdminCertificatesService` transitively imports the DID/VC services, which
// import `jose` (ESM) — unloadable under ts-jest/CommonJS. The payment paths
// do not touch it, so a bare stub is enough.
jest.mock('jose', () => ({
  SignJWT: class {},
  jwtVerify: jest.fn(),
  importPKCS8: jest.fn(),
  importSPKI: jest.fn(),
}));

import * as os from 'os';
import * as path from 'path';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LightningInvoiceStatus, LightningProvider } from '../../lightning/entities/lightning-invoice.entity';
import { PaymentStatus } from '../../lightning/entities/payment.entity';
import { BitnobApiError } from '../../bitnob/services/bitnob-http-client.service';
import { AccountStatus } from '../../identity/entities/user.entity';
import { AdminCertificateRequestStatus } from '../entities/admin-certificate-request.entity';
import { getCertificateTypeDefinition } from '../admin-certificates.constants';
import { AdminCertificatesService, RequestActor } from './admin-certificates.service';

const PRICE = getCertificateTypeDefinition('residence')!.priceSats;
const HOLDER: RequestActor = { userId: 'holder-1', roles: ['holder'] };
const OTHER: RequestActor = { userId: 'holder-2', roles: ['holder'] };
const ISSUER: RequestActor = { userId: 'issuer-1', roles: ['issuer'] };

/** Stand-in for TypeORM's WHERE: the repository only returns the request when one of the OR-ed clauses matches. */
const matchesWhere = (request: Record<string, unknown>, where: Record<string, unknown> | Record<string, unknown>[]) =>
  (Array.isArray(where) ? where : [where]).some((clause) => Object.entries(clause).every(([k, v]) => request[k] === v));

const makeRequest = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  holderUserId: 'holder-1',
  organizationId: 'org-1',
  certificateType: 'residence',
  status: AdminCertificateRequestStatus.ACCEPTED,
  paymentId: null as string | null,
  ...over,
});

const bitnobInvoice = (over: Record<string, unknown> = {}) => ({
  externalId: 'bn-1',
  paymentRequest: 'lnbc-test',
  paymentHash: 'hash-1',
  amountSats: PRICE,
  status: 'pending',
  expiresAt: new Date('2026-10-04T07:00:00Z'),
  reference: null,
  ...over,
});

const ledgerInvoice = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  provider: LightningProvider.BITNOB,
  externalId: 'bn-1',
  paymentHash: 'hash-1',
  paymentRequest: 'lnbc-test',
  amountSats: PRICE,
  expiresAt: new Date('2026-10-04T07:00:00Z'),
  status: LightningInvoiceStatus.PENDING,
  ...over,
});

/** The payments row of a request whose invoice is paid, as the ledger sync reads it (invoice joined). */
const ledgerPaidPayment = () => ({
  id: 'pay-1',
  status: PaymentStatus.PAID,
  purposeType: 'admin_certificate_request',
  purposeId: 'req-1',
  amountSats: PRICE,
  lightningInvoice: ledgerInvoice({ status: LightningInvoiceStatus.PAID }),
});

/**
 * Request-scoped payment behaviour of `AdminCertificatesService`: who may touch a request, the atomic claim that stops two invoices for one request,
 * re-invoicing after an expired invoice, how a paid invoice reaches the request, and the Bitnob read
 * fallback. The constructor is built positionally (same technique as the payout spec).
 */
describe('AdminCertificatesService — request payment (Bitnob)', () => {
  let requestsRepo: { findOne: jest.Mock; save: jest.Mock; update: jest.Mock };
  let paymentsRepo: { findOne: jest.Mock; count: jest.Mock };
  let lightning: { recordInvoice: jest.Mock };
  let bitnobLightning: { createInvoice: jest.Mock };
  let settlement: { settleIfPaid: jest.Mock };
  let organizationsRepo: { findOne: jest.Mock };
  let usersRepo: { findOne: jest.Mock };
  let kyc: { assertVerifiedFor: jest.Mock };
  let configValues: Record<string, string>;
  let errorSpy: jest.SpyInstance;
  let service: AdminCertificatesService;

  beforeEach(() => {
    process.env.ADMIN_CERTIFICATES_STORAGE_DIR = path.join(os.tmpdir(), 'dioteko-spec-storage');
    requestsRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (x) => x),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    paymentsRepo = { findOne: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) };
    organizationsRepo = { findOne: jest.fn().mockResolvedValue(null) };
    // The issuer belongs to org-1, the organization of makeRequest().
    usersRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'issuer-1', organizationId: 'org-1', accountStatus: AccountStatus.ACTIVE }),
    };
    lightning = { recordInvoice: jest.fn() };
    bitnobLightning = { createInvoice: jest.fn() };
    settlement = { settleIfPaid: jest.fn() };
    configValues = {};
    const config = { get: jest.fn((k: string, d?: unknown) => configValues[k] ?? d) };

    kyc = { assertVerifiedFor: jest.fn().mockResolvedValue(undefined) };
    const args = [
      requestsRepo,
      undefined, // refsRepository
      organizationsRepo,
      paymentsRepo,
      undefined, // bitnobPayoutsRepository
      undefined, // dataSource
      lightning,
      undefined, // didService
      undefined, // credentialIssuanceService
      undefined, // credentialVerificationService
      undefined, // certificateAnchorService
      undefined, // certificatePdfService
      config,
      undefined, // accessLogService
      undefined, // bitnobPayoutsService
      bitnobLightning,
      settlement,
      usersRepo,
      undefined, // revocationService
      kyc,
    ];
    service = new (AdminCertificatesService as unknown as new (...a: unknown[]) => AdminCertificatesService)(...args);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  /** Makes the request repository honour the WHERE clause the service builds (scope included). */
  const givenRequest = (request: Record<string, unknown>) =>
    requestsRepo.findOne.mockImplementation(
      async ({ where }: { where: Record<string, unknown> | Record<string, unknown>[] }) =>
        matchesWhere(request, where) ? request : null,
    );

  describe('createInvoiceForRequest', () => {
    const recorded = (over: Record<string, unknown> = {}) => ({
      invoice: ledgerInvoice(over),
      payment: { id: 'pay-1' },
    });
    const claimCall = (status: string) => [
      { id: 'req-1', status },
      { status: AdminCertificateRequestStatus.AWAITING_PAYMENT },
    ];

    it('refuses to invoice, with no claim and no provider call, when the holder lacks the required KYC', async () => {
      givenRequest(makeRequest({ status: AdminCertificateRequestStatus.ACCEPTED }));
      kyc.assertVerifiedFor.mockRejectedValue(new ForbiddenException({ code: 'KYC_REQUIRED', message: 'kyc' }));

      await expect(service.createInvoiceForRequest('req-1', HOLDER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(requestsRepo.update).not.toHaveBeenCalled();
      expect(bitnobLightning.createInvoice).not.toHaveBeenCalled();
    });

    it.each([
      AdminCertificateRequestStatus.PENDING,
      AdminCertificateRequestStatus.NEEDS_INFO,
      AdminCertificateRequestStatus.REJECTED,
    ])('refuses to invoice a request that is %s (not accepted by the organization), with no claim and no provider call', async (status) => {
      givenRequest(makeRequest({ status }));

      await expect(service.createInvoiceForRequest('req-1', HOLDER)).rejects.toBeInstanceOf(BadRequestException);
      expect(requestsRepo.update).not.toHaveBeenCalled();
      expect(bitnobLightning.createInvoice).not.toHaveBeenCalled();
    });

    it('claims the request, creates the invoice at Bitnob with the dkinv_<request id> key, records it', async () => {
      const request = makeRequest();
      givenRequest(request);
      bitnobLightning.createInvoice.mockResolvedValue(bitnobInvoice());
      lightning.recordInvoice.mockResolvedValue(recorded());

      const result = await service.createInvoiceForRequest('req-1', HOLDER);

      expect(requestsRepo.update).toHaveBeenNthCalledWith(1, ...claimCall(AdminCertificateRequestStatus.ACCEPTED));
      expect(bitnobLightning.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ amountSats: PRICE, reference: 'dkinv_req-1' }),
      );
      expect(lightning.recordInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: LightningProvider.BITNOB,
          externalId: 'bn-1',
          paymentHash: 'hash-1',
          purposeId: 'req-1',
        }),
      );
      expect(request.status).toBe(AdminCertificateRequestStatus.AWAITING_PAYMENT);
      expect(request.paymentId).toBe('pay-1');
      expect(result).toMatchObject({ provider: LightningProvider.BITNOB, paymentRequest: 'lnbc-test', amountSats: PRICE });
    });

    it('409s and calls no provider when another call already claimed the request (double tap)', async () => {
      givenRequest(makeRequest());
      requestsRepo.update.mockResolvedValue({ affected: 0 });

      await expect(service.createInvoiceForRequest('req-1', HOLDER)).rejects.toBeInstanceOf(ConflictException);
      expect(bitnobLightning.createInvoice).not.toHaveBeenCalled();
      expect(lightning.recordInvoice).not.toHaveBeenCalled();
    });

    it('gives the claim back (request pending again) when Bitnob fails, and answers 502 without leaking its body', async () => {
      givenRequest(makeRequest());
      bitnobLightning.createInvoice.mockRejectedValue(new BitnobApiError('failed', 500, { detail: 'internal secret' }));

      const failure = service.createInvoiceForRequest('req-1', HOLDER);
      await expect(failure).rejects.toBeInstanceOf(BadGatewayException);
      await expect(failure).rejects.toMatchObject({ message: 'The payment provider could not create the invoice' });
      expect(requestsRepo.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'req-1', status: AdminCertificateRequestStatus.AWAITING_PAYMENT }),
        { status: AdminCertificateRequestStatus.ACCEPTED },
      );
    });

    it('turns an unexpected (non-API) provider answer into a 502 instead of a bare 500', async () => {
      givenRequest(makeRequest());
      bitnobLightning.createInvoice.mockRejectedValue(new Error('Bitnob invoice response is missing id'));

      await expect(service.createInvoiceForRequest('req-1', HOLDER)).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('fails closed (502, nothing recorded) when Bitnob returns another amount, and logs the orphan invoice id', async () => {
      givenRequest(makeRequest());
      bitnobLightning.createInvoice.mockResolvedValue(bitnobInvoice({ amountSats: PRICE * 1000 }));

      await expect(service.createInvoiceForRequest('req-1', HOLDER)).rejects.toBeInstanceOf(BadGatewayException);
      expect(lightning.recordInvoice).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ORPHAN externalId=bn-1'));
    });

    it('logs the orphan Bitnob invoice and releases the request when recording it fails', async () => {
      givenRequest(makeRequest());
      bitnobLightning.createInvoice.mockResolvedValue(bitnobInvoice());
      lightning.recordInvoice.mockRejectedValue(new Error('unique violation'));

      await expect(service.createInvoiceForRequest('req-1', HOLDER)).rejects.toThrow('unique violation');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ORPHAN externalId=bn-1 paymentHash=hash-1'));
      expect(requestsRepo.update).toHaveBeenLastCalledWith(expect.anything(), {
        status: AdminCertificateRequestStatus.ACCEPTED,
      });
    });

    it('reuses an invoice a previous attempt created but never linked, without calling Bitnob', async () => {
      const request = makeRequest();
      givenRequest(request);
      paymentsRepo.findOne.mockResolvedValueOnce({
        id: 'pay-9',
        status: PaymentStatus.PENDING,
        lightningInvoice: ledgerInvoice(),
      });

      const result = await service.createInvoiceForRequest('req-1', HOLDER);

      expect(bitnobLightning.createInvoice).not.toHaveBeenCalled();
      expect(request.paymentId).toBe('pay-9');
      expect(result.paymentRequest).toBe('lnbc-test');
    });

    it('re-invoices after an expired invoice: reopens the request and uses a new idempotency key', async () => {
      const request = makeRequest({ status: AdminCertificateRequestStatus.AWAITING_PAYMENT, paymentId: 'pay-1' });
      givenRequest(request);
      const expired = ledgerInvoice();
      paymentsRepo.findOne
        .mockResolvedValueOnce({ id: 'pay-1', lightningInvoice: expired }) // refreshRequestPayment
        .mockResolvedValueOnce({ id: 'pay-1', status: PaymentStatus.FAILED }) // reopen: payment status
        .mockResolvedValueOnce(null); // findOpenInvoiceForRequest
      settlement.settleIfPaid.mockImplementation(async (i: { status: string }) => {
        i.status = LightningInvoiceStatus.EXPIRED;
        return { outcome: 'closed', remoteStatus: 'expired' };
      });
      paymentsRepo.count.mockResolvedValue(1);
      bitnobLightning.createInvoice.mockResolvedValue(bitnobInvoice({ externalId: 'bn-2', paymentHash: 'hash-2' }));
      lightning.recordInvoice.mockResolvedValue({
        invoice: ledgerInvoice({ id: 'inv-2', externalId: 'bn-2', paymentHash: 'hash-2' }),
        payment: { id: 'pay-2' },
      });

      const result = await service.createInvoiceForRequest('req-1', HOLDER);

      expect(requestsRepo.update).toHaveBeenNthCalledWith(
        1,
        { id: 'req-1', status: AdminCertificateRequestStatus.AWAITING_PAYMENT, paymentId: 'pay-1' },
        { status: AdminCertificateRequestStatus.ACCEPTED, paymentId: null },
      );
      expect(bitnobLightning.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ reference: 'dkinv_req-1_1' }));
      expect(request.paymentId).toBe('pay-2');
      expect(result.paymentHash).toBe('hash-2');
    });

    it('does NOT reopen a request whose invoice is still pending', async () => {
      givenRequest(
        makeRequest({ status: AdminCertificateRequestStatus.AWAITING_PAYMENT, paymentId: 'pay-1' }),
      );
      paymentsRepo.findOne.mockResolvedValueOnce({ id: 'pay-1', lightningInvoice: ledgerInvoice() });
      settlement.settleIfPaid.mockResolvedValue({ outcome: 'not_paid', remoteStatus: 'pending' });

      await expect(service.createInvoiceForRequest('req-1', HOLDER)).rejects.toBeInstanceOf(BadRequestException);
      expect(bitnobLightning.createInvoice).not.toHaveBeenCalled();
    });

    it('answers 404 to another holder before any provider call (same answer as an unknown request)', async () => {
      givenRequest(makeRequest());

      await expect(service.createInvoiceForRequest('req-1', OTHER)).rejects.toBeInstanceOf(NotFoundException);
      expect(requestsRepo.update).not.toHaveBeenCalled();
      expect(bitnobLightning.createInvoice).not.toHaveBeenCalled();
    });

    it('answers 404 to an issuer of ANOTHER organization, with no write and no provider call', async () => {
      givenRequest(makeRequest());
      usersRepo.findOne.mockResolvedValue({ id: 'issuer-1', organizationId: 'org-2', accountStatus: AccountStatus.ACTIVE });

      await expect(service.createInvoiceForRequest('req-1', ISSUER)).rejects.toBeInstanceOf(NotFoundException);
      expect(requestsRepo.update).not.toHaveBeenCalled();
      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
      expect(bitnobLightning.createInvoice).not.toHaveBeenCalled();
    });

    it('ignores the JWT roles when the account is suspended in the DB (staff path closed)', async () => {
      givenRequest(makeRequest());
      usersRepo.findOne.mockResolvedValue({ id: 'issuer-1', organizationId: 'org-1', accountStatus: AccountStatus.SUSPENDED });

      await expect(service.createInvoiceForRequest('req-1', ISSUER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('keeps the holder path for a holder who is also staff of another organization', async () => {
      givenRequest(makeRequest({ holderUserId: 'issuer-1' }));
      usersRepo.findOne.mockResolvedValue({ id: 'issuer-1', organizationId: 'org-2', accountStatus: AccountStatus.ACTIVE });
      bitnobLightning.createInvoice.mockResolvedValue(bitnobInvoice());
      lightning.recordInvoice.mockResolvedValue(recorded());

      await expect(service.createInvoiceForRequest('req-1', ISSUER)).resolves.toBeDefined();
    });

    it('ignores an open invoice for this request whose amount is not the catalog price (planted 1-sat invoice)', async () => {
      givenRequest(makeRequest());
      paymentsRepo.findOne.mockResolvedValueOnce({
        id: 'pay-evil',
        status: PaymentStatus.PENDING,
        lightningInvoice: ledgerInvoice({ amountSats: 1 }),
      });
      bitnobLightning.createInvoice.mockResolvedValue(bitnobInvoice());
      lightning.recordInvoice.mockResolvedValue(recorded());

      const result = await service.createInvoiceForRequest('req-1', HOLDER);

      expect(bitnobLightning.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ amountSats: PRICE }));
      expect(result.amountSats).toBe(PRICE);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('unexpected amount'));
    });

    it('does not let staff create an invoice on a citizen\'s behalf (holder only), even in the same organization', async () => {
      givenRequest(makeRequest());

      await expect(service.createInvoiceForRequest('req-1', ISSUER)).rejects.toBeInstanceOf(NotFoundException);
      expect(requestsRepo.update).not.toHaveBeenCalled();
      expect(bitnobLightning.createInvoice).not.toHaveBeenCalled();
    });

    it('fails closed (404, no query) when the actor id is missing, instead of widening the WHERE', async () => {
      await expect(
        service.createInvoiceForRequest('req-1', { userId: undefined as unknown as string, roles: ['issuer'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(requestsRepo.findOne).not.toHaveBeenCalled();
    });

    it('does not crash when the token carries no roles', async () => {
      givenRequest(makeRequest());
      bitnobLightning.createInvoice.mockResolvedValue(bitnobInvoice());
      lightning.recordInvoice.mockResolvedValue(recorded());

      await expect(
        service.createInvoiceForRequest('req-1', { userId: 'holder-1', roles: undefined as unknown as string[] }),
      ).resolves.toBeDefined();
    });
  });

  describe('checkRequestPaymentStatus', () => {
    const awaiting = () =>
      makeRequest({ status: AdminCertificateRequestStatus.AWAITING_PAYMENT, paymentId: 'pay-1' });

    it('reads Bitnob as a fallback, and promotes the request once the ledger says paid', async () => {
      const request = awaiting();
      const inv = ledgerInvoice();
      givenRequest(request);
      paymentsRepo.findOne
        .mockResolvedValueOnce({ id: 'pay-1', lightningInvoice: inv }) // refreshRequestPayment
        .mockResolvedValueOnce(ledgerPaidPayment()); // ledger sync
      settlement.settleIfPaid.mockImplementation(async (i: { status: string }) => {
        i.status = LightningInvoiceStatus.PAID;
        return { outcome: 'paid' };
      });

      const result = await service.checkRequestPaymentStatus('req-1', HOLDER);

      expect(settlement.settleIfPaid).toHaveBeenCalledWith(inv);
      expect(request.status).toBe(AdminCertificateRequestStatus.PAID);
      expect(result).toMatchObject({ status: AdminCertificateRequestStatus.PAID, invoiceStatus: 'paid', provider: 'bitnob' });
    });

    it('keeps the request awaiting payment when Bitnob says it is not paid', async () => {
      const request = awaiting();
      givenRequest(request);
      paymentsRepo.findOne
        .mockResolvedValueOnce({ id: 'pay-1', lightningInvoice: ledgerInvoice() })
        .mockResolvedValueOnce({ id: 'pay-1', status: PaymentStatus.PENDING });
      settlement.settleIfPaid.mockResolvedValue({ outcome: 'not_paid', remoteStatus: 'pending' });

      const result = await service.checkRequestPaymentStatus('req-1', HOLDER);

      expect(request.status).toBe(AdminCertificateRequestStatus.AWAITING_PAYMENT);
      expect(result.invoiceStatus).toBe('pending');
    });

    it('survives a Bitnob read failure (still pending, no 500)', async () => {
      givenRequest(awaiting());
      paymentsRepo.findOne
        .mockResolvedValueOnce({ id: 'pay-1', lightningInvoice: ledgerInvoice() })
        .mockResolvedValueOnce({ id: 'pay-1', status: PaymentStatus.PENDING });
      settlement.settleIfPaid.mockRejectedValue(new BitnobApiError('down', 503, null));

      await expect(service.checkRequestPaymentStatus('req-1', HOLDER)).resolves.toMatchObject({
        status: AdminCertificateRequestStatus.AWAITING_PAYMENT,
      });
    });

    it('reports an expired invoice so the app can offer a new one', async () => {
      givenRequest(awaiting());
      paymentsRepo.findOne
        .mockResolvedValueOnce({ id: 'pay-1', lightningInvoice: ledgerInvoice() })
        .mockResolvedValueOnce({ id: 'pay-1', status: PaymentStatus.FAILED });
      settlement.settleIfPaid.mockImplementation(async (i: { status: string }) => {
        i.status = LightningInvoiceStatus.EXPIRED;
        return { outcome: 'closed', remoteStatus: 'expired' };
      });

      await expect(service.checkRequestPaymentStatus('req-1', HOLDER)).resolves.toMatchObject({
        status: AdminCertificateRequestStatus.AWAITING_PAYMENT,
        invoiceStatus: 'expired',
      });
    });

    it('promotes a request whose payment the webhook already marked paid', async () => {
      const request = awaiting();
      givenRequest(request);
      paymentsRepo.findOne
        .mockResolvedValueOnce({ id: 'pay-1', lightningInvoice: ledgerInvoice({ status: LightningInvoiceStatus.PAID }) })
        .mockResolvedValueOnce(ledgerPaidPayment());
      settlement.settleIfPaid.mockResolvedValue({ outcome: 'already_paid' });

      await service.checkRequestPaymentStatus('req-1', HOLDER);

      expect(request.status).toBe(AdminCertificateRequestStatus.PAID);
    });

    it('answers 404 to another holder', async () => {
      givenRequest(awaiting());
      await expect(service.checkRequestPaymentStatus('req-1', OTHER)).rejects.toBeInstanceOf(NotFoundException);
      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
    });

    it('answers 404 to an issuer of another organization, before reading Bitnob', async () => {
      givenRequest(awaiting());
      usersRepo.findOne.mockResolvedValue({ id: 'issuer-1', organizationId: 'org-2', accountStatus: AccountStatus.ACTIVE });

      await expect(service.checkRequestPaymentStatus('req-1', ISSUER)).rejects.toBeInstanceOf(NotFoundException);
      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
      expect(requestsRepo.save).not.toHaveBeenCalled();
    });

    it('never asks Bitnob about a historic LNbits invoice', async () => {
      givenRequest(awaiting());
      const lnbitsInvoice = ledgerInvoice({ provider: LightningProvider.LNBITS, externalId: null });
      paymentsRepo.findOne
        .mockResolvedValueOnce({ id: 'pay-1', lightningInvoice: lnbitsInvoice })
        .mockResolvedValueOnce({ id: 'pay-1', status: PaymentStatus.PENDING });

      await service.checkRequestPaymentStatus('req-1', HOLDER);

      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
    });

    it('404s when the linked invoice no longer exists', async () => {
      givenRequest(awaiting());
      paymentsRepo.findOne.mockResolvedValueOnce({ id: 'pay-1', lightningInvoice: null });

      await expect(service.checkRequestPaymentStatus('req-1', HOLDER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getOpenInvoice', () => {
    const open = (over: Record<string, unknown> = {}) => ({
      id: 'pay-1',
      purposeId: 'req-1',
      status: PaymentStatus.PENDING,
      lightningInvoice: ledgerInvoice({ paymentRequest: 'lnbc-open', expiresAt: new Date(Date.now() + 60_000) }),
      ...over,
    });
    const awaiting = () =>
      givenRequest(makeRequest({ status: AdminCertificateRequestStatus.AWAITING_PAYMENT, paymentId: 'pay-1' }));

    it('returns the holder\'s still-payable invoice', async () => {
      awaiting();
      paymentsRepo.findOne.mockResolvedValue(open());

      const invoice = await service.getOpenInvoice('req-1', HOLDER);

      expect(invoice).toEqual({
        provider: LightningProvider.BITNOB,
        paymentRequest: 'lnbc-open',
        amountSats: PRICE,
        expiresAt: expect.any(Date),
      });
    });

    it('answers 404 to anyone but the holder (staff included), without reading the payment', async () => {
      awaiting();

      await expect(service.getOpenInvoice('req-1', ISSUER)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getOpenInvoice('req-1', { userId: 'someone-else', roles: ['holder'] })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(paymentsRepo.findOne).not.toHaveBeenCalled();
    });

    it.each([
      ['a request that is not awaiting payment', () => givenRequest(makeRequest({ status: AdminCertificateRequestStatus.ACCEPTED }))],
      ['a request with no payment', () => givenRequest(makeRequest({ status: AdminCertificateRequestStatus.AWAITING_PAYMENT, paymentId: null }))],
    ])('answers 404 for %s', async (_label, arrange) => {
      arrange();

      await expect(service.getOpenInvoice('req-1', HOLDER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      ['an expired invoice', { lightningInvoice: ledgerInvoice({ status: LightningInvoiceStatus.EXPIRED }) }],
      ['an invoice whose expiry has passed', { lightningInvoice: ledgerInvoice({ expiresAt: new Date(Date.now() - 1000) }) }],
      ['a paid payment', { status: PaymentStatus.PAID }],
      ['a payment of another request', { purposeId: 'req-other' }],
      ['a payment without invoice', { lightningInvoice: null }],
    ])('answers 404 for %s', async (_label, over) => {
      awaiting();
      paymentsRepo.findOne.mockResolvedValue(open(over));

      await expect(service.getOpenInvoice('req-1', HOLDER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('issueForRequest', () => {
    const paidRequest = (over: Record<string, unknown> = {}) =>
      makeRequest({ status: AdminCertificateRequestStatus.AWAITING_PAYMENT, paymentId: 'pay-1', ...over });

    it('answers 404 to an issuer of another organization, with no Bitnob read and no write', async () => {
      givenRequest(paidRequest());
      usersRepo.findOne.mockResolvedValue({ id: 'issuer-1', organizationId: 'org-2', accountStatus: AccountStatus.ACTIVE });

      await expect(service.issueForRequest('req-1', ISSUER)).rejects.toBeInstanceOf(NotFoundException);
      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
      expect(paymentsRepo.findOne).not.toHaveBeenCalled();
      expect(requestsRepo.save).not.toHaveBeenCalled();
    });

    it('answers 404 to the holder alone (no staff role): issuing is staff-only', async () => {
      givenRequest(paidRequest());

      await expect(service.issueForRequest('req-1', HOLDER)).rejects.toBeInstanceOf(NotFoundException);
      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
    });

    it('uses the organization stored in the DB, not what the token claims', async () => {
      givenRequest(paidRequest());
      usersRepo.findOne.mockResolvedValue({ id: 'admin-9', organizationId: 'org-2', accountStatus: AccountStatus.ACTIVE });

      await expect(service.issueForRequest('req-1', { userId: 'admin-9', roles: ['admin'] })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
    });

    it('refuses (403) an issuer who is the holder of the request: four-eyes rule', async () => {
      givenRequest(paidRequest({ holderUserId: 'issuer-1' }));

      await expect(service.issueForRequest('req-1', ISSUER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
    });

    it('asks Bitnob first, so a lost webhook does not strand a paid request', async () => {
      const request = makeRequest({ status: AdminCertificateRequestStatus.AWAITING_PAYMENT, paymentId: 'pay-1' });
      givenRequest(request);
      paymentsRepo.findOne
        .mockResolvedValueOnce({ id: 'pay-1', lightningInvoice: ledgerInvoice() }) // refreshRequestPayment
        .mockResolvedValueOnce(ledgerPaidPayment()); // ledger sync
      settlement.settleIfPaid.mockResolvedValue({ outcome: 'paid' });

      // Issuance stops at the missing organisation: reaching it proves the scope and the "not paid" guard did not fire.
      await expect(service.issueForRequest('req-1', ISSUER)).rejects.toThrow('Issuing organization not found');
      expect(settlement.settleIfPaid).toHaveBeenCalled();
      expect(request.status).toBe(AdminCertificateRequestStatus.PAID);
    });

    it('promotes an awaiting request whose payment is already paid in the ledger (webhook-only settlement)', async () => {
      const request = makeRequest({ status: AdminCertificateRequestStatus.AWAITING_PAYMENT, paymentId: 'pay-1' });
      givenRequest(request);
      paymentsRepo.findOne
        .mockResolvedValueOnce({ id: 'pay-1', lightningInvoice: ledgerInvoice({ status: LightningInvoiceStatus.PAID }) })
        .mockResolvedValueOnce(ledgerPaidPayment());
      settlement.settleIfPaid.mockResolvedValue({ outcome: 'already_paid' });

      await expect(service.issueForRequest('req-1', ISSUER)).rejects.toThrow('Issuing organization not found');
      expect(request.status).toBe(AdminCertificateRequestStatus.PAID);
    });

    it('still refuses a request whose payment is not paid', async () => {
      givenRequest(
        makeRequest({ status: AdminCertificateRequestStatus.AWAITING_PAYMENT, paymentId: 'pay-1' }),
      );
      paymentsRepo.findOne
        .mockResolvedValueOnce({ id: 'pay-1', lightningInvoice: ledgerInvoice() })
        .mockResolvedValueOnce({ id: 'pay-1', status: PaymentStatus.PENDING });
      settlement.settleIfPaid.mockResolvedValue({ outcome: 'not_paid', remoteStatus: 'pending' });

      await expect(service.issueForRequest('req-1', ISSUER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not read Bitnob on issue for a historic LNbits invoice', async () => {
      givenRequest(
        makeRequest({ status: AdminCertificateRequestStatus.AWAITING_PAYMENT, paymentId: 'pay-1' }),
      );
      paymentsRepo.findOne
        .mockResolvedValueOnce({
          id: 'pay-1',
          lightningInvoice: ledgerInvoice({ provider: LightningProvider.LNBITS, externalId: null }),
        })
        .mockResolvedValueOnce({ id: 'pay-1', status: PaymentStatus.PENDING });

      await expect(service.issueForRequest('req-1', ISSUER)).rejects.toBeInstanceOf(BadRequestException);
      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
    });
  });
});
