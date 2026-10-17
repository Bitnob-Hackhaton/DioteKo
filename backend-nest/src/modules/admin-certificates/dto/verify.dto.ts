import { IsOptional, IsString } from 'class-validator';

/**
 * Body for `POST /admin-certificates/:certificateId/verify`. `documentHash`
 * is optional — omit it to check signature/status/expiry alone; supply it
 * to also assert the credential's content hash matches what the caller
 * holds. See `AdminCertificatesService.verifyCertificate`'s doc comment for
 * which hash this must be (`credential.hash`, not the Bitcoin-anchor
 * fingerprint) for the comparison to ever succeed.
 */
export class VerifyDto {
  @IsOptional()
  @IsString()
  documentHash?: string;
}
