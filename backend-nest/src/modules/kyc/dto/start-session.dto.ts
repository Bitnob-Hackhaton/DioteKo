import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { KYC_DOCUMENT_TYPES, KycDocumentType } from '../kyc.constants';

export class StartSessionDto {
  @ApiProperty({ enum: KYC_DOCUMENT_TYPES })
  @IsIn(KYC_DOCUMENT_TYPES)
  documentType: KycDocumentType;

  @ApiProperty({ required: false, example: 'SN', description: 'ISO 3166-1 alpha-2 code of the country that issued the document' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'issuingCountry must be an ISO 3166-1 alpha-2 code in capitals' })
  issuingCountry?: string;
}
