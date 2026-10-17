import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AdminCertificateRequestStatus } from '../entities/admin-certificate-request.entity';
import { CERTIFICATE_VALIDITIES, CertificateValidity } from '../admin-certificates.constants';

/**
 * Query params for the request lists — `GET /api/admin-certificates/requests` (the caller's own requests) and
 * `GET /api/admin-certificates/organization/requests` (staff side) — with offset pagination.
 * Declared as a DTO so the global `forbidNonWhitelisted` pipe accepts these keys and rejects anything else —
 * in particular a `userId`/`holderUserId`, which must never come from the client.
 */
export class ListRequestsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  offset: number = 0;

  /** Filter on the request workflow status: one value, a comma-separated list (`?status=paid,issued`) or a repeated key. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(Object.values(AdminCertificateRequestStatus).length)
  @IsIn(Object.values(AdminCertificateRequestStatus), { each: true })
  status?: AdminCertificateRequestStatus[];

  /** Filter on the issued certificate's validity; only issued requests can match. */
  @IsOptional()
  @IsIn([...CERTIFICATE_VALIDITIES])
  validity?: CertificateValidity;
}
