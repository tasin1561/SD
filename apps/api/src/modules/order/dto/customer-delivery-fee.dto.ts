import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

export class SetCustomerDeliveryFeeDto {
  @ApiProperty({
    minimum: 0,
    maximum: 100000,
    description:
      'What to pre-fill as the delivery fee on a new order. Autofill only — it does not ' +
      'change what Skydrop charges you, and you can edit the figure on any order.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  amountInr!: number;
}
