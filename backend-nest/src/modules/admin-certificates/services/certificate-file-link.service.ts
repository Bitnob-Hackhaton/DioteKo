import { createHmac, timingSafeEqual } from 'crypto';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** How long a download link stays valid. Short on purpose: the app asks for a fresh one at each download. */
export const CERTIFICATE_FILE_LINK_TTL_SECONDS = 300;

/**
 * Short-lived signed links for `GET /admin-certificates/:certificateId/file`. The file route is opened by the phone's
 * browser, which cannot send the Bearer token, so the (authenticated) holder first asks for a link carrying
 * `exp` + an HMAC of `certificateId.exp` keyed with the server secret. Knowing a certificate id is no longer enough
 * to download its PDF (the id is also printed in the QR code of the document).
 */
@Injectable()
export class CertificateFileLinkService {
  constructor(private readonly configService: ConfigService) {}

  sign(certificateId: string, now = new Date()): { exp: number; sig: string } {
    const exp = Math.floor(now.getTime() / 1000) + CERTIFICATE_FILE_LINK_TTL_SECONDS;
    return { exp, sig: this.mac(certificateId, exp) };
  }

  /** Throws 403 unless `exp` is in the future and `sig` matches this certificate (constant-time comparison). */
  assertValid(certificateId: string, exp: string | undefined, sig: string | undefined, now = new Date()): void {
    const expSeconds = Number(exp);
    if (!exp || !sig || !Number.isInteger(expSeconds) || expSeconds * 1000 < now.getTime()) {
      throw new ForbiddenException('Invalid or expired download link');
    }
    const expected = Buffer.from(this.mac(certificateId, expSeconds));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new ForbiddenException('Invalid or expired download link');
    }
  }

  private mac(certificateId: string, exp: number): string {
    const secret = this.configService.get<string>('jwt.secret');
    if (!secret) {
      // Fail closed: never sign with an empty key.
      throw new Error('JWT secret is not configured');
    }
    return createHmac('sha256', secret).update(`file:${certificateId}.${exp}`).digest('hex');
  }
}
