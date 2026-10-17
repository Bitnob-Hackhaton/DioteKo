import { Logger } from '@nestjs/common';
import { BitnobApiError, BitnobHttpClientService } from './bitnob-http-client.service';
import {
  BitnobLightningService,
  DEFAULT_INVOICE_EXPIRY_SECONDS,
  mapBitnobInvoice,
  parseBitnobExpiry,
} from './bitnob-lightning.service';

// Shape observed live against the Bitnob sandbox on 2026-10-04 (docs/BITNOB.md, "Lightning pay-in").
const CREATE_DATA = {
  id: '01a10581-6e8b-7258-95cb-c3babda25c68',
  payment_hash: '92c849ca9a699cb8212ecf32a4291ad7f56fc5d183cd0f0fe9297789ddc39df7',
  request: 'lnbc10u1pexample',
  amount_sat: '1000',
  description: 'probe',
  status: 'pending',
  expires_at: '2026-10-04T06:17:10Z',
  created_at: '2026-10-04T06:02:10Z',
};
const envelope = (data: unknown) => ({ success: true, message: 'ok', data, timestamp: '2026-10-04T06:02:10Z' });

describe('BitnobLightningService', () => {
  let http: { get: jest.Mock; post: jest.Mock };
  let service: BitnobLightningService;

  beforeEach(() => {
    http = { get: jest.fn(), post: jest.fn() };
    service = new BitnobLightningService(http as unknown as BitnobHttpClientService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('createInvoice', () => {
    it('posts amount in satoshis with description, expiry and the idempotency reference, and sends no customer_id', async () => {
      http.post.mockResolvedValue(envelope(CREATE_DATA));

      const invoice = await service.createInvoice({ amountSats: 1000, description: 'probe', reference: 'dkinv_req-1' });

      expect(http.post).toHaveBeenCalledWith('/api/lightning/invoices', {
        amount: 1000,
        description: 'probe',
        expiry: DEFAULT_INVOICE_EXPIRY_SECONDS,
        reference: 'dkinv_req-1',
      });
      expect(http.post.mock.calls[0][1]).not.toHaveProperty('customer_id');
      expect(invoice).toEqual({
        externalId: CREATE_DATA.id,
        paymentRequest: 'lnbc10u1pexample',
        paymentHash: CREATE_DATA.payment_hash,
        amountSats: 1000,
        status: 'pending',
        expiresAt: new Date('2026-10-04T06:17:10Z'),
        reference: null,
      });
    });

    it('honours an explicit expiry', async () => {
      http.post.mockResolvedValue(envelope(CREATE_DATA));
      await service.createInvoice({ amountSats: 1000, description: 'd', reference: 'r', expirySeconds: 600 });
      expect(http.post.mock.calls[0][1]).toMatchObject({ expiry: 600 });
    });

    it('lets a BitnobApiError through untouched (callers read status, never a body)', async () => {
      const error = new BitnobApiError('Bitnob API request failed', 403, { detail: 'secret detail' });
      http.post.mockRejectedValue(error);
      await expect(service.createInvoice({ amountSats: 1, description: 'd', reference: 'r' })).rejects.toBe(error);
    });

    it('throws when the response lacks the BOLT11 request, so a changed shape fails loudly', async () => {
      http.post.mockResolvedValue(envelope({ ...CREATE_DATA, request: undefined }));
      await expect(service.createInvoice({ amountSats: 1, description: 'd', reference: 'r' })).rejects.toThrow(
        /missing id, request or payment_hash/,
      );
    });
  });

  describe('getInvoice', () => {
    it('reads by id, URL-encoding it, and maps the Unix-seconds expiry used by get/list', async () => {
      http.get.mockResolvedValue(
        envelope({ ...CREATE_DATA, status: 'paid', expires_at: '1791094630', reference: 'dkinv_req-1' }),
      );

      const invoice = await service.getInvoice('a/b');

      expect(http.get).toHaveBeenCalledWith('/api/lightning/invoices/a%2Fb');
      expect(invoice.status).toBe('paid');
      expect(invoice.expiresAt).toEqual(new Date(1791094630 * 1000));
      expect(invoice.reference).toBe('dkinv_req-1');
    });

    it('maps an unrecognised status to "unknown" (never to paid)', async () => {
      http.get.mockResolvedValue(envelope({ ...CREATE_DATA, status: 'settled' }));
      expect((await service.getInvoice('x')).status).toBe('unknown');
    });
  });
});

describe('parseBitnobExpiry', () => {
  it.each([
    ['2026-10-04T06:17:10Z', new Date('2026-10-04T06:17:10Z')],
    ['1791094630', new Date(1791094630 * 1000)],
    [1791094630, new Date(1791094630 * 1000)],
    ['', null],
    [null, null],
    [undefined, null],
    ['not a date', null],
  ])('parses %p', (input, expected) => {
    expect(parseBitnobExpiry(input)).toEqual(expected);
  });
});

describe('mapBitnobInvoice', () => {
  it.each(['1000.5', '100abc', '-5', ' 10', '1e3'])('rejects a non-integer amount %p (changed contract)', (amount) => {
    expect(() => mapBitnobInvoice({ ...CREATE_DATA, amount_sat: amount })).toThrow(/amount_sat/);
  });

  it('rejects a non-positive or missing amount', () => {
    expect(() => mapBitnobInvoice({ ...CREATE_DATA, amount_sat: '0' })).toThrow(/amount_sat/);
    expect(() => mapBitnobInvoice({ ...CREATE_DATA, amount_sat: undefined })).toThrow(/amount_sat/);
  });
});
