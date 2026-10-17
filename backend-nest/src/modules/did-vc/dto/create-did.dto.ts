import { IsOptional, IsUUID } from 'class-validator';

/**
 * Both fields optional at the DTO level — `DidService.createDid` is the
 * source of truth for the "exactly one" invariant and throws a clear
 * `BadRequestException` if it's violated.
 */
export class CreateDidDto {
  @IsOptional()
  @IsUUID()
  controllerUserId?: string;

  @IsOptional()
  @IsUUID()
  controllerOrganizationId?: string;
}
