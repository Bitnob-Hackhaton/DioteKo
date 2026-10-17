import { createHash } from 'crypto';

/**
 * SHA-256 hex digest of a string or Buffer.
 *
 * Used for content-integrity hashing — e.g. `verifiable_credentials.hash`
 * (modules/did-vc, modules/admin-certificates) and anywhere else a stable
 * fingerprint of a document/payload is needed.
 */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}
