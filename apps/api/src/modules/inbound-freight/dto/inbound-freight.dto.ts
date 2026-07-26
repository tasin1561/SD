import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InboundFreightMode, InboundFreightStatus } from '@skydrop/db';
import {
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RecordInboundFreightDto {
  @ApiProperty({ description: 'UUID v7 of the goods receipt this freight bill covers' })
  @IsUUID('7')
  readonly goodsReceiptId!: string;

  @ApiProperty({
    description: 'Freight invoice amount, INR canonical. Decimal string (e.g. "4500.00").',
  })
  @IsNumberString()
  readonly amountInr!: string;

  @ApiPropertyOptional({
    enum: InboundFreightMode,
    description:
      "Overrides the seller's resolved payment mode for this one consignment. Omit to use `wallet.inbound_freight_mode`.",
  })
  @IsOptional()
  @IsEnum(InboundFreightMode)
  readonly mode?: InboundFreightMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly note?: string;
}

export class WaiveInboundFreightDto {
  @ApiProperty({
    description:
      'Why the bill is being forgiven. Recorded on the charge and audited at HIGH — waivers are money we chose not to collect.',
    minLength: 10,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  readonly reason!: string;
}

export class ListInboundFreightQueryDto {
  @ApiPropertyOptional({ enum: InboundFreightStatus })
  @IsOptional()
  @IsEnum(InboundFreightStatus)
  readonly status?: InboundFreightStatus;

  @ApiPropertyOptional({ description: 'Admin only — scope to one seller.' })
  @IsOptional()
  @IsUUID('7')
  readonly sellerId?: string;
}
