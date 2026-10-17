import { BitnobHttpClientService } from './bitnob-http-client.service';
import { BitnobTransactionsService } from './bitnob-transactions.service';

function envelope<T>(data: T) {
  return { success: true, message: 'ok', data, timestamp: '2026-08-29T00:00:00Z' };
}

describe('BitnobTransactionsService', () => {
  let http: { get: jest.Mock };
  let service: BitnobTransactionsService;

  beforeEach(() => {
    http = { get: jest.fn() };
    service = new BitnobTransactionsService(http as unknown as BitnobHttpClientService);
  });

  it('list() forwards only the defined query keys and unwraps data.transactions', async () => {
    const transactions = [{ transaction_id: 't1' }, { transaction_id: 't2' }];
    http.get.mockResolvedValue(
      envelope({ transactions, next_cursor: 'c2', previous_cursor: '', total_count: 2, has_more: true }),
    );

    const result = await service.list({ status: 'SETTLED', limit: 5 });

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get.mock.calls[0][0]).toBe('/api/transactions');
    // toStrictEqual (unlike toHaveBeenCalledWith / toEqual) does NOT ignore
    // `undefined`-valued keys — this is the regression guard for "drop
    // undefined query keys before calling the HTTP client".
    expect(http.get.mock.calls[0][1]).toStrictEqual({ status: 'SETTLED', limit: 5 });
    expect(result.transactions).toBe(transactions);
    expect(result.has_more).toBe(true);
  });

  it('list() with no options sends an empty query object', async () => {
    http.get.mockResolvedValue(
      envelope({ transactions: [], next_cursor: '', previous_cursor: '', total_count: 0, has_more: false }),
    );

    await service.list();

    expect(http.get.mock.calls[0][0]).toBe('/api/transactions');
    expect(http.get.mock.calls[0][1]).toStrictEqual({});
  });

  it('getById() hits /api/transactions/:id and unwraps the envelope', async () => {
    http.get.mockResolvedValue(envelope({ transaction_id: 'abc-123', state: 'SETTLED' }));

    const result = await service.getById('abc-123');

    expect(http.get).toHaveBeenCalledWith('/api/transactions/abc-123');
    expect(result.state).toBe('SETTLED');
  });

  it('getById() passes an already-unwrapped resource object straight through', async () => {
    http.get.mockResolvedValue({ transaction_id: 'abc-123', state: 'FAILED' });

    const result = await service.getById('abc-123');

    expect(result.state).toBe('FAILED');
  });
});
