import * as crypto from 'crypto';

/**
 * Bitnob HMAC request-signing primitives.
 *
 * Pure functions only — no I/O, no NestJS DI — so each step of the signing
 * pipeline is independently testable and reviewable in isolation. Consumed
 * exclusively by `BitnobHttpClientService`, which computes these headers
 * PER REQUEST (never via a global axios interceptor).
 *
 * The `payload` field of the signed `stringToSign` is the EXACT string the
 * caller hands to `buildAuthHeaders` — nothing is re-serialized, sorted, or
 * trimmed here. `BitnobHttpClientService` guarantees that same string is the
 * literal request body written to the wire (it passes the identical string
 * to axios with a `transformRequest` identity fn), so the signature always
 * covers the exact sent bytes. GET / bodyless requests pass `''`.
 *
 * This is security-sensitive code. The spec below (header names, the
 * colon-separated `stringToSign` field order, hex encoding) must match
 * Bitnob's real docs exactly — do not "improve" or refactor the shape of any
 * of these functions without re-verifying against a live sandbox. Callers
 * must sign per-request and never cache or reuse the returned headers.
 *
 *   stringToSign = `${clientId}:${timestampSeconds}:${nonce}:${payload}`
 *   signature    = hex(HMAC-SHA256(stringToSign, clientSecret))
 *   headers      = X-Auth-Client, X-Auth-Timestamp, X-Auth-Nonce,
 *                  X-Auth-Signature, Content-Type
 */

/** 16 random bytes, hex-encoded (32 hex chars). Fresh on every call. */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** Current Unix time in whole seconds, as a string (the header's wire format). */
export function timestampSeconds(): string {
  return Math.floor(Date.now() / 1000).toString();
}

/** Colon-separated string-to-sign, exact field order per Bitnob's spec. */
export function buildStringToSign(clientId: string, timestamp: string, nonce: string, payload: string): string {
  return `${clientId}:${timestamp}:${nonce}:${payload}`;
}

/** HMAC-SHA256 of `stringToSign` keyed by the Bitnob client secret, hex-encoded. */
export function sign(stringToSign: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(stringToSign).digest('hex');
}

/**
 * Full per-request auth header set. Generates a fresh nonce/timestamp on
 * every call — callers must NOT cache or reuse the result across requests.
 *
 * `payload` is signed verbatim: it MUST be the exact request body the
 * caller then sends on the wire (or `''` for a GET / bodyless request).
 */
export function buildAuthHeaders(clientId: string, secret: string, payload: string): Record<string, string> {
  const timestamp = timestampSeconds();
  const nonce = generateNonce();
  const stringToSign = buildStringToSign(clientId, timestamp, nonce, payload);
  const signature = sign(stringToSign, secret);

  return {
    'X-Auth-Client': clientId,
    'X-Auth-Timestamp': timestamp,
    'X-Auth-Nonce': nonce,
    'X-Auth-Signature': signature,
    'Content-Type': 'application/json',
  };
}
