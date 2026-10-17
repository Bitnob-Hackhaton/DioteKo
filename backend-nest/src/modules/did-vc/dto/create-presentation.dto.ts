import { ArrayNotEmpty, IsArray, IsObject, IsOptional, IsUUID } from 'class-validator';

export class CreatePresentationDto {
  @IsUUID()
  holderDidId: string;

  @IsOptional()
  @IsUUID()
  verifierOrganizationId?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  credentialIds: string[];

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
