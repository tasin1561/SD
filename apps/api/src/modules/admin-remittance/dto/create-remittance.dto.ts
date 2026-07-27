import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Currency } from '@skydrop/db';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Admin records a manual bank transfer to a seller.
 *
 * `sourceCurrency` / `sourceAmount` describe the side the wallet is
 * debited from (INR for BD→IN seller — that's where COD lands).
 * `currency` / `amount` describe the side the bank actually received
 * (BDT for BD-seller). `fxRateSnapshot` is the rate used to derive
 * the destination from the source — operator-supplied so it matches
 * exactly what was used on the bank side.
 *
 * For same-currency remits, source = dest; fxRateSnapshot = 1.
 */
export class CreateRemittanceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('7')
  sellerId!: string;

  @ApiProperty({
    enum: Currency,
    description: 'Currency that hit the bank (matches seller bank account)',
  })
  @IsEnum(Currency)
  currency!: Currency;

  @ApiProperty({ minimum: 0.01 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty({
    enum: Currency,
    description: 'Currency the wallet is debited from (typically INR)',
  })
  @IsEnum(Currency)
  sourceCurrency!: Currency;

  @ApiProperty({ minimum: 0.01 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  sourceAmount!: number;

  @ApiProperty({ minimum: 0.000001, description: 'FX rate applied (1 for same-currency)' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  fxRateSnapshot!: number;

  @ApiProperty({
    minLength: 1,
    maxLength: 120,
    description: 'Bank reference / payout id from the operator',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  bankReference!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  paidAt!: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
