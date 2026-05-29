import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Currency } from '@skydrop/db';
import { IsEnum, IsNumber, IsString, Length, Min } from 'class-validator';

export class SetFxRateDto {
  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  fromCurrency!: Currency;

  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  toCurrency!: Currency;

  @ApiProperty({ description: 'Decimal rate; must be > 0' })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.000001)
  rate!: number;

  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @Length(10, 500)
  reason!: string;
}
