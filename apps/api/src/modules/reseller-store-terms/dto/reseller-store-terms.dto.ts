import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ResellerCreditTrigger } from '@skydrop/db';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * A store share as text — "80", "33.33". The range (0–100) is the
 * service's to refuse, with a code; this only keeps out what is not a
 * number with at most two decimals.
 */
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
const PERCENT_MESSAGE = 'a percent from 0 to 100, with at most two decimals';

/** The six shares, as the Terms form sends them. */
export class TermsSharesDto {
  @ApiProperty({ example: '80' })
  @Matches(PERCENT, { message: `deliveryFeeStorePercent must be ${PERCENT_MESSAGE}` })
  deliveryFeeStorePercent!: string;

  @ApiProperty({ example: '100' })
  @Matches(PERCENT, { message: `returnFeeStorePercent must be ${PERCENT_MESSAGE}` })
  returnFeeStorePercent!: string;

  @ApiProperty({ example: '100' })
  @Matches(PERCENT, { message: `customerReturnFeeStorePercent must be ${PERCENT_MESSAGE}` })
  customerReturnFeeStorePercent!: string;

  @ApiProperty({ example: '0' })
  @Matches(PERCENT, { message: `codFeeStorePercent must be ${PERCENT_MESSAGE}` })
  codFeeStorePercent!: string;

  @ApiProperty({ example: '100' })
  @Matches(PERCENT, { message: `codTaxStorePercent must be ${PERCENT_MESSAGE}` })
  codTaxStorePercent!: string;

  @ApiProperty({ example: '100' })
  @Matches(PERCENT, { message: `instantPayFeeStorePercent must be ${PERCENT_MESSAGE}` })
  instantPayFeeStorePercent!: string;
}

export class PublishTermsDto extends TermsSharesDto {
  @ApiProperty({ enum: ResellerCreditTrigger })
  @IsEnum(ResellerCreditTrigger)
  storeCreditTrigger!: ResellerCreditTrigger;

  @ApiProperty({ minimum: 0, maximum: 365 })
  @IsInt()
  @Min(0)
  @Max(365)
  storeCreditDays!: number;

  @ApiProperty({ enum: ResellerCreditTrigger })
  @IsEnum(ResellerCreditTrigger)
  sellerCreditTrigger!: ResellerCreditTrigger;

  @ApiProperty({ minimum: 0, maximum: 365 })
  @IsInt()
  @Min(0)
  @Max(365)
  sellerCreditDays!: number;

  @ApiPropertyOptional({ description: 'What changed, for the store to read.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description: 'The version you were looking at (0 when there was none). A newer one is refused.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  basedOnVersion?: number;
}

/** The draft, as query parameters — the Terms tab's live worked example. */
export class PreviewTermsQueryDto extends TermsSharesDto {
  @ApiPropertyOptional({ enum: ResellerCreditTrigger })
  @IsOptional()
  @IsEnum(ResellerCreditTrigger)
  storeCreditTrigger?: ResellerCreditTrigger;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  storeCreditDays?: number;

  @ApiPropertyOptional({ enum: ResellerCreditTrigger })
  @IsOptional()
  @IsEnum(ResellerCreditTrigger)
  sellerCreditTrigger?: ResellerCreditTrigger;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  sellerCreditDays?: number;
}

export class SetCreditAfterConfirmationDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ minLength: 20, description: 'Why — audited HIGH with the seller.' })
  @IsString()
  @MinLength(20, { message: 'Say why, in at least 20 characters.' })
  @MaxLength(500)
  reason!: string;
}
