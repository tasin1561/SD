import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InboundFreightBasis, InboundFreightMode, InboundFreightStatus } from '@skydrop/db';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * One line off the forwarder's invoice.
 *
 * Freight is quoted either by weight or by the piece, and both appear on
 * the same invoice — air freight per kilo, a consolidator's handling per
 * carton — so the basis is per LINE rather than per bill.
 */
export class InboundFreightLineDto {
  @ApiProperty({ description: 'UUID v7 of the counted goods-receipt line being priced' })
  @IsUUID('7')
  readonly goodsReceiptLineId!: string;

  @ApiProperty({ enum: InboundFreightBasis })
  @IsEnum(InboundFreightBasis)
  readonly basis!: InboundFreightBasis;

  @ApiProperty({ description: 'Rate as invoiced — per kg, or per piece. Decimal string.' })
  @IsNumberString()
  readonly rateInr!: string;

  @ApiPropertyOptional({
    description:
      'Chargeable weight in kg, REQUIRED for PER_KG and ignored otherwise. Use the ' +
      "forwarder's figure: volumetric weight and rounding up to the next half-kilo are both " +
      'normal, so a weight worked out from the catalogue would not match the invoice.',
  })
  @IsOptional()
  @IsNumberString()
  readonly chargeableWeightKg?: string;
}

export class RecordInboundFreightDto {
  @ApiProperty({
    description:
      'UUID v7 of the INDIA ARRIVAL (goods receipt, leg IN_FINAL) this freight bill covers. ' +
      'One forwarder invoice per shipment; the consignment is derived from it.',
  })
  @IsUUID('7')
  readonly goodsReceiptId!: string;

  @ApiProperty({
    type: [InboundFreightLineDto],
    description:
      "The forwarder's invoice, line by line. EVERY counted product on the arrival must " +
      'appear: one left out would ship freight-free permanently, because a unit with no ' +
      'allocation row is skipped when it leaves. The bill total is the sum of these lines.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => InboundFreightLineDto)
  readonly lines!: readonly InboundFreightLineDto[];

  @ApiPropertyOptional({
    enum: InboundFreightMode,
    description:
      "Overrides the seller's resolved payment mode for this one arrival. Omit to use `wallet.inbound_freight_mode`.",
  })
  @IsOptional()
  @IsEnum(InboundFreightMode)
  readonly mode?: InboundFreightMode;

  @ApiPropertyOptional({
    description:
      'What the FORWARDER charged US for this shipment, in INR. The lines above are what ' +
      'the SELLER is billed; the gap between them is our margin on the BD→India leg, and ' +
      'without this the P&L reads that whole leg as pure profit. Optional because it often ' +
      'arrives on a later invoice — record it then rather than guessing now.',
  })
  @IsOptional()
  @IsNumberString()
  readonly ourCostInr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  readonly note?: string;
}

export class SetFreightOurCostDto {
  @ApiProperty({ description: 'What the forwarder charged us, in INR' })
  @IsNumberString()
  readonly ourCostInr!: string;
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
