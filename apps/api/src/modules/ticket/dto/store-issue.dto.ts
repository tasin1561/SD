import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * 2026-09-16 — a reseller store raising something with SKYDROP about one
 * of its own orders.
 *
 * Deliberately a separate DTO from `CreateStoreDisputeDto` even though
 * the fields match: the two are different acts, and a shared DTO is how
 * one of them quietly acquires the other's wording.
 */
export class CreateStoreIssueDto {
  @ApiProperty({ description: 'The store’s own order this is about.' })
  @IsUUID()
  readonly orderId!: string;

  @ApiProperty({ maxLength: 200, example: 'Parcel came back crushed' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  readonly subject!: string;

  @ApiPropertyOptional({
    maxLength: 4000,
    description: 'What happened, in the store’s words. Skydrop reads it; the seller is not told.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  readonly description?: string;
}
