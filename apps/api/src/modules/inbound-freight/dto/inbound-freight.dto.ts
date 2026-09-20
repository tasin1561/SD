import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Currency,
  InboundFreightBasis,
  InboundFreightMode,
  InboundFreightStatus,
} from '@skydrop/db';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
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

  @ApiProperty({
    description:
      "Rate as AGREED — per kg, or per piece — in the bill's `currency`, NOT necessarily " +
      'rupees. Decimal string.',
  })
  @IsNumberString()
  readonly rate!: string;

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
      'UUID v7 of the goods receipt this freight bill covers. WHICH receipt depends on the ' +
      "consignment's freight mode: PAY_ADVANCE bills the BANGLADESH INTAKE (the count and " +
      'weight it is priced from, raised before the goods fly), PAY_NOW and PAY_LATER bill the ' +
      'INDIA ARRIVAL (leg IN_FINAL — one forwarder invoice per shipment). The consignment is ' +
      'derived from it.',
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
    enum: Currency,
    description:
      'What the rates above are AGREED in. Defaults to INR. A non-INR bill is converted to ' +
      'rupees at the moment it is recorded, and the rate used is stored on the bill — the ' +
      'seller is charged rupees whatever the rate was agreed in.',
  })
  @IsOptional()
  @IsEnum(Currency)
  readonly currency?: Currency;

  @ApiPropertyOptional({
    enum: InboundFreightMode,
    description:
      'PINS the consignment to this mode as part of raising the bill. Omit to use whatever ' +
      'is already in force for it (its own pin, else the seller override of ' +
      '`wallet.inbound_freight_mode`, else the global default).',
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

export class PayForwarderDto {
  @ApiProperty({ description: 'Which of our accounts the money left' })
  @IsUUID()
  readonly bankAccountId!: string;

  @ApiProperty({
    description: "What left the account, in the ACCOUNT's own currency (INR or BDT)",
    example: '2000.00',
  })
  // A string, not a number: a money figure through JSON's float is how
  // 2000.10 becomes 2000.0999999999999.
  @Matches(/^\d{1,12}(\.\d{1,2})?$/, { message: 'Amount must be a number with up to 2 decimals' })
  readonly amountPaid!: string;

  @ApiPropertyOptional({
    description:
      'The client’s key for this request, generated once when the form opens. A replay with the same key returns the bill as it stands and records nothing.',
  })
  @IsOptional()
  @IsUUID('4')
  readonly idempotencyKey?: string;

  @ApiProperty({
    description:
      'When the bank actually moved it. A non-INR payment is priced in rupees at the rate in force at THIS instant.',
  })
  @IsDateString()
  readonly occurredAt!: string;

  @ApiPropertyOptional({ description: "The bank's own reference for the payment" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  readonly reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly note?: string;
}

export class AttributeExpenseDto {
  @ApiProperty({ description: 'An expense already recorded on /expenses' })
  @IsUUID('7')
  readonly bankEntryId!: string;
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

export class VoidInboundFreightDto {
  @ApiProperty({
    description:
      'Why the bill was wrong — a mistyped rate, a recount. Recorded on the bill, shown on ' +
      "the seller's consignment timeline, and audited HIGH: this hands money back.",
    minLength: 10,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  readonly reason!: string;
}

export class SetConsignmentFreightModeDto {
  @ApiPropertyOptional({
    enum: InboundFreightMode,
    description:
      'Pin this consignment to one mode, or send null to clear the pin so it falls through ' +
      'to the seller override and then the global default. Refused once a bill exists ' +
      '(FREIGHT_MODE_LOCKED) — how an already-raised bill was going to be paid is settled.',
    nullable: true,
  })
  @IsOptional()
  @IsEnum(InboundFreightMode)
  readonly mode?: InboundFreightMode | null;
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

  @ApiPropertyOptional({
    description:
      "Free text over consignment number, goods-receipt number and seller name — what somebody holding a forwarder's invoice would recognise.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  readonly search?: string;
}
