import { ForbiddenException } from '@nestjs/common';
import { CERTIFICATE_FILE_LINK_TTL_SECONDS, CertificateFileLinkService } from './certificate-file-link.service';

const make = (secret: string | null = 'secret-a') =>
  new CertificateFileLinkService({ get: jest.fn(() => secret) } as never);
const NOW = new Date('2026-10-14T10:00:00Z');

describe('CertificateFileLinkService', () => {
  it('accepts a fresh link for the certificate it was signed for', () => {
    const service = make();
    const { exp, sig } = service.sign('cert-1', NOW);
    expect(() => service.assertValid('cert-1', String(exp), sig, NOW)).not.toThrow();
  });

  it('expires after the TTL', () => {
    const service = make();
    const { exp, sig } = service.sign('cert-1', NOW);
    const later = new Date(NOW.getTime() + (CERTIFICATE_FILE_LINK_TTL_SECONDS + 1) * 1000);
    expect(() => service.assertValid('cert-1', String(exp), sig, later)).toThrow(ForbiddenException);
  });

  it('refuses a link signed for another certificate, a tampered signature or expiry, and a missing signature', () => {
    const service = make();
    const { exp, sig } = service.sign('cert-1', NOW);
    expect(() => service.assertValid('cert-2', String(exp), sig, NOW)).toThrow(ForbiddenException);
    expect(() => service.assertValid('cert-1', String(exp), `${sig.slice(0, -1)}0`, NOW)).toThrow(ForbiddenException);
    expect(() => service.assertValid('cert-1', String(exp + 3600), sig, NOW)).toThrow(ForbiddenException);
    expect(() => service.assertValid('cert-1', undefined, undefined, NOW)).toThrow(ForbiddenException);
    expect(() => service.assertValid('cert-1', 'abc', 'x', NOW)).toThrow(ForbiddenException);
  });

  it('refuses a signature made with another secret', () => {
    const { exp, sig } = make('secret-b').sign('cert-1', NOW);
    expect(() => make('secret-a').assertValid('cert-1', String(exp), sig, NOW)).toThrow(ForbiddenException);
  });

  it('never signs without a secret', () => {
    expect(() => make(null).sign('cert-1', NOW)).toThrow(/secret/);
  });
});
