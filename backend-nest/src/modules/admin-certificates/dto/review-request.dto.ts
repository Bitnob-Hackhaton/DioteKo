import { Transform } from 'class-transformer';
import { IsNotEmpty, IsObject, IsString, MaxLength, MinLength } from 'class-validator';
import { DECISION_TEXT_MAX_LENGTH, DECISION_TEXT_MIN_LENGTH } from '../admin-certificates.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Body of `POST organization/requests/:requestId/reject`: the reason is mandatory and shown to the holder. */
export class RejectRequestDto {
  @Transform(trim)
  @IsString()
  @MinLength(DECISION_TEXT_MIN_LENGTH)
  @MaxLength(DECISION_TEXT_MAX_LENGTH)
  reason: string;
}

/** Body of `POST organization/requests/:requestId/request-info`: what the holder must correct or add. */
export class RequestInfoDto {
  @Transform(trim)
  @IsString()
  @MinLength(DECISION_TEXT_MIN_LENGTH)
  @MaxLength(DECISION_TEXT_MAX_LENGTH)
  message: string;
}

/** Body of `POST requests/:requestId/resubmit`: the corrected data, replacing `submittedData` as a whole. */
export class ResubmitRequestDto {
  @IsObject()
  @IsNotEmpty()
  submittedData: Record<string, unknown>;
}
