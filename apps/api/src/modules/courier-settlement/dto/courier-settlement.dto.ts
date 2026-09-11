import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBase64,
  IsDateString,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SettlementLineDto {
  @ApiProperty({ description: 'UUID v7 of the order this part of the payout covers' })
  @IsUUID('7')
  readonly orderId!: string;

  @ApiProperty({ description: 'INR the courier attributed to this order (decimal string)' })
  @IsNumberString()
  readonly settledInr!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly note?: string;
}

/** One order whose earlier-paid COD the courier took back in this payout. */
export class RtoReversalDto {
  @ApiProperty({ description: 'UUID v7 of the order whose COD was reversed' })
  @IsUUID('7')
  readonly orderId!: string;

  @ApiProperty({ description: 'INR taken back for it (decimal string) — its whole COD' })
  @IsNumberString()
  readonly amountInr!: string;
}

/** What the courier kept back from the COD before paying — from its remittance file. */
export class SettlementDeductionsDto {
  @ApiPropertyOptional({
    type: [RtoReversalDto],
    description:
      'The orders an RTO reversal takes COD back for. Required when there is an RTO reversal: the seller credited for each is debited back and our deductions returned, so it must be exact.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RtoReversalDto)
  readonly rtoReversals?: RtoReversalDto[];

  @ApiPropertyOptional({
    description:
      'Early-COD / remittance fee the courier kept (decimal string). Booked as an expense.',
  })
  @IsOptional()
  @IsNumberString()
  readonly earlyCodFeeInr?: string;

  @ApiPropertyOptional({ description: 'Freight the courier took out of the COD (decimal string).' })
  @IsOptional()
  @IsNumberString()
  readonly freightInr?: string;

  @ApiPropertyOptional({
    description: 'COD clawed back for a parcel that later returned (decimal string).',
  })
  @IsOptional()
  @IsNumberString()
  readonly rtoReversalInr?: string;
}

export class RecordSettlementDto {
  @ApiProperty()
  @IsUUID('7')
  readonly courierAccountId!: string;

  @ApiProperty({
    description:
      "The courier's own payout / UTR reference. Unique per account — this is what makes recording the same bank credit twice a 409 instead of double-counting.",
  })
  @IsString()
  @MaxLength(200)
  readonly reference!: string;

  @ApiProperty({ description: 'Total INR that actually landed (decimal string)' })
  @IsNumberString()
  readonly amountInr!: string;

  @ApiProperty({ description: 'When the payout landed (ISO 8601)' })
  @IsDateString()
  readonly receivedAt!: string;

  @ApiProperty({ type: [SettlementLineDto], description: 'Per-order allocation of the payout' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => SettlementLineDto)
  readonly lines!: SettlementLineDto[];

  @ApiPropertyOptional({
    type: SettlementDeductionsDto,
    description:
      'What the courier kept back before paying. Amount received + these = the COD the payout covers, so a payout that states them is fully explained rather than short.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SettlementDeductionsDto)
  readonly deductions?: SettlementDeductionsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly note?: string;
}

export class AllocateMoreDto {
  @ApiProperty({
    type: [SettlementLineDto],
    description:
      'The orders this already-recorded payout ALSO covers. The payout total is never changed ' +
      '— it is what the bank statement says — so this can only move cash from capital to the ' +
      'sellers it belongs to, never invent any.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SettlementLineDto)
  readonly lines!: SettlementLineDto[];
}

export class PreviewRemittanceDto {
  @ApiProperty({ description: 'The courier whose export this is — its columns are read exactly.' })
  @IsString()
  @MaxLength(40)
  readonly courierCode!: string;

  @ApiPropertyOptional({
    description:
      'The remittance file, as CSV text. Read-only: this endpoint matches waybills to orders and ' +
      'moves no money, so an operator can see what will and will not allocate before recording. ' +
      'Send this OR fileBase64, not both.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5_000_000)
  readonly csvText?: string;

  @ApiPropertyOptional({
    description:
      "The courier's file exactly as downloaded, base64-encoded — .csv, .xls (Shiprocket) or " +
      '.xlsx; the format is recognised from its bytes. Send this OR csvText, not both.',
  })
  @IsOptional()
  @IsBase64()
  @MaxLength(8_000_000)
  readonly fileBase64?: string;

  @ApiPropertyOptional({ description: 'The file name, for messages only.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  readonly fileName?: string;
}

export class ReconciliationQueryDto {
  @ApiPropertyOptional({
    description:
      'How many days after delivery an unsettled order counts as overdue. Default 10 — the top of Delhivery’s stated 5-10 day window.',
    minimum: 1,
    maximum: 120,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  readonly overdueAfterDays?: number;
}
