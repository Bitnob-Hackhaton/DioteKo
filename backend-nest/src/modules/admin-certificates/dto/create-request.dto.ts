import { IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/**
 * Body for admin-certificate request creation (`AdminCertificatesController`
 * -> `AdminCertificatesService.createRequest`). `certificateType` is
 * validated against the `ADMIN_CERTIFICATE_TYPES` catalog by the service
 * (not here) so the 400 error can name the unknown type explicitly.
 * `submittedData` is stored as-is into `submitted_data` (jsonb) and later
 * becomes the VC's `credentialSubject` verbatim at issuance time.
 * `organizationId` (optional) picks the issuing municipality/ministry; the
 * service checks it exists and has an issuing type, and falls back to a
 * deterministic default when absent.
 */
export class CreateRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[a-z0-9_-]+$/i)
  certificateType: string;

  @IsObject()
  @IsNotEmpty()
  submittedData: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
