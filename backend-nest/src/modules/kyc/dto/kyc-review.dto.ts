import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { KYC_REVIEW_ORIGINS, KycReviewOrigin } from '../kyc.constants';

export const KYC_REVIEW_LIST_STATUSES = ['manual_review', 'verified', 'rejected'] as const;
export type KycReviewListStatus = (typeof KYC_REVIEW_LIST_STATUSES)[number];

/**
 * Query of `GET /api/kyc/review`. A DTO so the global `forbidNonWhitelisted` pipe rejects any other key, in
 * particular a `userId`: the queue is never filtered by a client-chosen holder.
 */
export class ListKycReviewsQueryDto {
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

  @IsOptional()
  @IsIn(KYC_REVIEW_LIST_STATUSES)
  status?: KycReviewListStatus;

  @IsOptional()
  @IsIn(KYC_REVIEW_ORIGINS)
  origin?: KycReviewOrigin;
}

export const KYC_REVIEW_DECISIONS = ['approve', 'reject'] as const;
export type KycReviewDecision = (typeof KYC_REVIEW_DECISIONS)[number];

export class DecideKycReviewDto {
  @IsIn(KYC_REVIEW_DECISIONS)
  decision: KycReviewDecision;

  /** Mandatory justification, kept with the decision (staff-only, never shown to the holder). */
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  note: string;
}
