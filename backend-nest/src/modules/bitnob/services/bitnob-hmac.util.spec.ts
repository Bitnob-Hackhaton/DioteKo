import * as crypto from 'crypto';
import { buildAuthHeaders, buildStringToSign, generateNonce, sign, timestampSeconds } from './bitnob-hmac.util';

describe('bitnob-hmac.util', () => {
  describe('generateNonce', () => {
    it('returns 32 lowercase hex chars', () => {
      const nonce = generateNonce();
      expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    });

    it('is different on each call', () => {
      expect(generateNonce()).not.toBe(generateNonce());
    });
  });

  describe('timestampSeconds', () => {
    it('is a stringified integer close to now (seconds)', () => {
      const now = Math.floor(Date.now() / 1000);
      const ts = timestampSeconds();
      expect(ts).toMatch(/^\d+$/);
      expect(Math.abs(Number(ts) - now)).toBeLessThanOrEqual(2);
    });
  });

  describe('buildStringToSign', () => {
    it('joins the four fields with colons, exact order', () => {
      expect(buildStringToSign('cid', '1700000000', 'abc', '{}')).toBe('cid:1700000000:abc:{}');
    });
  });

  describe('sign', () => {
    it('matches a hardcoded known-answer HMAC-SHA256 hex vector', () => {
      // Known answer computed once with node crypto, pasted as a literal so
      // this test fails if `sign`'s algorithm/encoding ever drifts:
      //   crypto.createHmac('sha256', 'test-secret')
      //     .update('cid:1700000000:abcdef0123456789:{"a":1}').digest('hex')
      expect(sign('cid:1700000000:abcdef0123456789:{"a":1}', 'test-secret')).toBe(
        '4b6871a3e465c0a5e34675ba3ff60d3ed124b696570828ca62084781d0b14341',
      );
    });

    it('matches a hand-computed HMAC-SHA256 hex digest for a fixed vector', () => {
      const secret = 'test-secret';
      const stringToSign = 'cid:1700000000:abc:{}';
      const expected = crypto.createHmac('sha256', secret).update(stringToSign).digest('hex');
      expect(sign(stringToSign, secret)).toBe(expected);
    });

    it('signs the exact payload string the caller sends ("Postman way")', () => {
      // The payload field is whatever bytes the HTTP client writes to the
      // wire — here, the compact JSON of a parsed object (insertion order).
      const secret = 'sek';
      const payload = JSON.stringify(JSON.parse('{"b":1,"a":2}')); // '{"b":1,"a":2}'
      const stringToSign = 'cid:1700000000:abc:' + payload;
      const expected = crypto.createHmac('sha256', secret).update(stringToSign).digest('hex');
      expect(sign(buildStringToSign('cid', '1700000000', 'abc', payload), secret)).toBe(expected);
    });
  });

  describe('buildAuthHeaders', () => {
    it('returns all 5 headers with a signature over the verbatim payload string', () => {
      const secret = 'sek';
      const payload = '{"z":1,"a":2}';
      const headers = buildAuthHeaders('cid', secret, payload);

      expect(Object.keys(headers).sort()).toEqual(
        ['Content-Type', 'X-Auth-Client', 'X-Auth-Nonce', 'X-Auth-Signature', 'X-Auth-Timestamp'].sort(),
      );
      expect(headers['X-Auth-Client']).toBe('cid');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Auth-Nonce']).toMatch(/^[0-9a-f]{32}$/);
      expect(headers['X-Auth-Timestamp']).toMatch(/^\d+$/);

      const expectedSig = sign(
        'cid:' + headers['X-Auth-Timestamp'] + ':' + headers['X-Auth-Nonce'] + ':' + payload,
        secret,
      );
      expect(headers['X-Auth-Signature']).toBe(expectedSig);
    });

    it('signs the payload verbatim — no key sorting', () => {
      const headers = buildAuthHeaders('cid', 'sek', '{"z":1,"a":2}');
      const sortedSig = sign(
        'cid:' + headers['X-Auth-Timestamp'] + ':' + headers['X-Auth-Nonce'] + ':' + '{"a":2,"z":1}',
        'sek',
      );
      expect(headers['X-Auth-Signature']).not.toBe(sortedSig);
    });
  });
});
