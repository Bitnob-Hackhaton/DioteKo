import { ConfigService } from '@nestjs/config';
import { BitnobHttpClientService } from './bitnob-http-client.service';
import { sign } from './bitnob-hmac.util';

const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';

function makeConfigStub(): ConfigService {
  const values: Record<string, unknown> = {
    'bitnob.clientId': CLIENT_ID,
    'bitnob.clientSecret': CLIENT_SECRET,
    'bitnob.baseUrl': 'https://api.bitnob.com',
  };
  return {
    get: <T>(key: string, defaultValue?: T): T =>
      (key in values ? (values[key] as T) : (defaultValue as T)),
  } as unknown as ConfigService;
}

/** Recompute the signature the util would have produced for a given wire payload. */
function expectedSignature(headers: Record<string, string>, payload: string): string {
  return sign(`${CLIENT_ID}:${headers['X-Auth-Timestamp']}:${headers['X-Auth-Nonce']}:${payload}`, CLIENT_SECRET);
}

describe('BitnobHttpClientService', () => {
  let service: BitnobHttpClientService;
  let http: { get: jest.Mock; post: jest.Mock };

  beforeEach(() => {
    service = new BitnobHttpClientService(makeConfigStub());
    // Reach past `private` to swap the internal axios instance for mocks.
    http = (service as unknown as { http: { get: jest.Mock; post: jest.Mock } }).http;
    http.get = jest.fn().mockResolvedValue({ status: 200, data: { ok: true } });
    http.post = jest.fn().mockResolvedValue({ status: 200, data: { ok: true } });
  });

  it('POST sends the insertion-order JSON string as the body arg and signs that exact string', async () => {
    await service.post('/x', { z: 1, a: 2 });

    expect(http.post).toHaveBeenCalledTimes(1);
    const [path, bodyArg, axiosConfig] = http.post.mock.calls[0];

    expect(path).toBe('/x');
    // NOT sorted — the exact bytes that go to the wire.
    expect(bodyArg).toBe('{"z":1,"a":2}');
    expect(typeof bodyArg).toBe('string');

    // transformRequest identity fn keeps axios from re-serializing the string.
    expect(axiosConfig.transformRequest).toHaveLength(1);
    expect(axiosConfig.transformRequest[0]('{"z":1,"a":2}')).toBe('{"z":1,"a":2}');

    // The signature covers exactly the body arg.
    expect(axiosConfig.headers['X-Auth-Signature']).toBe(expectedSignature(axiosConfig.headers, bodyArg));
    expect(axiosConfig.headers['Content-Type']).toBe('application/json');
  });

  it('POST with no body signs and sends "{}"', async () => {
    await service.post('/x');

    const [, bodyArg, axiosConfig] = http.post.mock.calls[0];
    expect(bodyArg).toBe('{}');
    expect(axiosConfig.headers['X-Auth-Signature']).toBe(expectedSignature(axiosConfig.headers, '{}'));
  });

  it('GET signs an empty body and forwards params', async () => {
    await service.get('/y', { limit: 5 });

    expect(http.get).toHaveBeenCalledTimes(1);
    const [path, axiosConfig] = http.get.mock.calls[0];

    expect(path).toBe('/y');
    expect(axiosConfig.params).toEqual({ limit: 5 });
    expect(axiosConfig.headers['X-Auth-Signature']).toBe(expectedSignature(axiosConfig.headers, ''));
  });

  it('GET without params forwards undefined params', async () => {
    await service.get('/y');

    const [, axiosConfig] = http.get.mock.calls[0];
    expect(axiosConfig.params).toBeUndefined();
    expect(axiosConfig.headers['X-Auth-Signature']).toBe(expectedSignature(axiosConfig.headers, ''));
  });
});
