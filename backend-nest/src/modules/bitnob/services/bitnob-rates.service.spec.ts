import { BitnobHttpClientService } from './bitnob-http-client.service';
import { BitnobRatesService } from './bitnob-rates.service';

function envelope<T>(data: T) {
  return { success: true, message: 'ok', data, timestamp: '2026-08-29T00:00:00Z' };
}

describe('BitnobRatesService', () => {
  let http: { get: jest.Mock };
  let service: BitnobRatesService;

  beforeEach(() => {
    http = { get: jest.fn() };
    service = new BitnobRatesService(http as unknown as BitnobHttpClientService);
  });

  it('getPair() → GET /api/exchange-rates with exactly { from, to }', async () => {
    http.get.mockResolvedValue(envelope({ base_currency: 'USDT', target_currency: 'NGN' }));

    const result = await service.getPair('USDT', 'NGN');

    expect(http.get.mock.calls[0][0]).toBe('/api/exchange-rates');
    expect(http.get.mock.calls[0][1]).toStrictEqual({ from: 'USDT', to: 'NGN' });
    expect(result.base_currency).toBe('USDT');
  });

  it('listByBase() → GET /api/exchange-rates with exactly { base }', async () => {
    http.get.mockResolvedValue(envelope({ base_currency: 'USDT', rates: [] }));

    await service.listByBase('USDT');

    expect(http.get.mock.calls[0][0]).toBe('/api/exchange-rates');
    expect(http.get.mock.calls[0][1]).toStrictEqual({ base: 'USDT' });
  });

  it('convert() → GET /api/exchange-rates/convert with exactly { from, to, amount }', async () => {
    http.get.mockResolvedValue(envelope({ from_currency: 'USDT', to_currency: 'NGN', to_amount: '16000' }));

    const result = await service.convert('USDT', 'NGN', '10');

    expect(http.get.mock.calls[0][0]).toBe('/api/exchange-rates/convert');
    expect(http.get.mock.calls[0][1]).toStrictEqual({ from: 'USDT', to: 'NGN', amount: '10' });
    expect(result.to_amount).toBe('16000');
  });
});
