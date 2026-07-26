import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '@skydrop/db';
import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

export class CreateWithdrawalRequestDto {
  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  currency!: Currency;

  @ApiProperty({ description: 'Decimal string, up to 2dp, e.g. "1500.00"' })
  @IsString()
  @Matches(DECIMAL_PATTERN, { message: 'amount must be a decimal string with up to 2 decimal places' })
  amount!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class MarkWithdrawalRequestPaidDto {
  @ApiProperty({ description: 'Id of an existing Remittance created via POST /admin/remittances' })
  @IsString()
  @MinLength(1)
  linkedRemittanceId!: string;
}

export class RejectWithdrawalRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
