import { And, FindOptionsWhere, IsNull, LessThanOrEqual, MoreThan, Or } from 'typeorm';
import {
  VerifiableCredential,
  VerifiableCredentialStatus,
} from '../did-vc/entities/verifiable-credential.entity';
import { CertificateValidity, EXPIRING_SOON_DAYS } from './admin-certificates.constants';
import { AdminCertificateRequest } from './entities/admin-certificate-request.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

const expiringSoonThreshold = (now: Date): Date => new Date(now.getTime() + EXPIRING_SOON_DAYS * DAY_MS);

/**
 * Validity of an issued certificate, from its credential. `null` when nothing is issued yet. Must stay in sync
 * with `buildValidityWhere` below: the list filter and the value shown on each item are the same rule.
 */
export function computeValidity(
  vc: Pick<VerifiableCredential, 'status' | 'expiresAt'> | null | undefined,
  now: Date = new Date(),
): CertificateValidity | null {
  if (!vc) {
    return null;
  }
  if (vc.status === VerifiableCredentialStatus.REVOKED) {
    return 'revoked';
  }
  const expiresAtMs = vc.expiresAt ? new Date(vc.expiresAt).getTime() : null;
  if (vc.status === VerifiableCredentialStatus.EXPIRED || (expiresAtMs !== null && expiresAtMs <= now.getTime())) {
    return 'expired';
  }
  if (expiresAtMs !== null && expiresAtMs <= expiringSoonThreshold(now).getTime()) {
    return 'expiring_soon';
  }
  return 'valid';
}

const onCredential = (vc: FindOptionsWhere<VerifiableCredential>): FindOptionsWhere<AdminCertificateRequest> => ({
  adminCertificateRef: { vc },
});

/**
 * TypeORM `where` fragments (to be OR-ed, each one merged with the caller's own `holderUserId`/`status`
 * conditions) selecting the requests whose issued certificate has the given validity. Requests without an issued
 * certificate never match, because the fragments constrain the joined credential.
 */
export function buildValidityWhere(
  validity: CertificateValidity,
  now: Date = new Date(),
): FindOptionsWhere<AdminCertificateRequest>[] {
  const soon = expiringSoonThreshold(now);
  switch (validity) {
    case 'valid':
      return [
        onCredential({
          status: VerifiableCredentialStatus.ACTIVE,
          expiresAt: Or(IsNull(), MoreThan(soon)),
        }),
      ];
    case 'expiring_soon':
      return [
        onCredential({
          status: VerifiableCredentialStatus.ACTIVE,
          expiresAt: And(MoreThan(now), LessThanOrEqual(soon)),
        }),
      ];
    case 'expired':
      return [
        onCredential({ status: VerifiableCredentialStatus.EXPIRED }),
        onCredential({ status: VerifiableCredentialStatus.ACTIVE, expiresAt: LessThanOrEqual(now) }),
      ];
    case 'revoked':
      return [onCredential({ status: VerifiableCredentialStatus.REVOKED })];
  }
}
