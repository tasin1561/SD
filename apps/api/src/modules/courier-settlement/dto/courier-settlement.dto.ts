import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly note?: string;
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
