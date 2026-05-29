import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaymentMode } from '@skydrop/db';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * Preview a pricing breakdown for a hypothetical order. No
 * persistence; the response is the engine's pure output.
 */
export class PreviewPricingDto {
  @ApiProperty()
  @IsUUID('7')
  sellerId!: string;

  @ApiProperty({ minLength: 4, maxLength: 10 })
  @IsString()
  @Length(4, 10)
  recipientPostalCode!: string;

  @ApiProperty({ required: false, default: 'IN' })
  @IsOptional()
  @IsString()
  recipientCountryCode?: string;

  @ApiProperty({ enum: PaymentMode })
  @IsEnum(PaymentMode)
  paymentMode!: PaymentMode;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  codAmountInr!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  declaredValueInr!: number;

  @ApiProperty({ minimum: 0, maximum: 100_000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  totalWeightGrams!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  courierCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  serviceType?: string;
}
