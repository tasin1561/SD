import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMode } from '@skydrop/db';
import { IsEnum, IsNumberString, IsOptional, Matches } from 'class-validator';

export class CheckServiceabilityQueryDto {
  @ApiProperty({ description: 'Six-digit Indian pincode' })
  @Matches(/^\d{6}$/, { message: 'pincode must be six digits' })
  readonly pincode!: string;

  @ApiProperty({ enum: PaymentMode })
  @IsEnum(PaymentMode)
  readonly paymentMode!: PaymentMode;

  @ApiPropertyOptional({ description: 'COD value, which some pins cap' })
  @IsOptional()
  @IsNumberString()
  readonly codAmountInr?: string;
}
