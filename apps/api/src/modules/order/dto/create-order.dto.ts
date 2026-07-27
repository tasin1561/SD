import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PackageType, PaymentMode } from '@skydrop/db';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** E.164 — same shape AddressValidationService / CustomerService enforce. */
const E164 = /^\+[1-9]\d{6,14}$/;

export class CreateOrderItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('7')
  variantId!: string;

  @ApiProperty({ minimum: 1, maximum: 100_000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity!: number;

  @ApiProperty({
    required: false,
    minimum: 0,
    description:
      'Per-unit INR price. Pricing engine is Module 15; persisted as-is when supplied, else null.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPriceInr?: number;
}

/**
 * Manual single-order entry (ORD source = MANUAL). The recipient block is
 * snapshotted immutably onto the order (CLAUDE MUST #10 / ORD-6); the
 * customer is resolved per-seller by `recipientPhoneE164` (ORD-7). No
 * stock is touched at create — reservation is LATE, at confirmation
 * (ORD-10 / Q9).
 */
export class CreateOrderDto {
  @ApiProperty({
    required: false,
    maxLength: 120,
    description: "Seller's own order id; unique within the seller.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sellerOrderRef?: string;

  // ── Recipient (immutable snapshot) ──────────────────────────────────

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MaxLength(160)
  recipientName!: string;

  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @Matches(E164, { message: 'recipientPhoneE164 must be E.164 (+<country><number>)' })
  recipientPhoneE164!: string;

  @ApiProperty({ required: false, example: '+919812345678' })
  @IsOptional()
  @IsString()
  @Matches(E164, { message: 'recipientAltPhoneE164 must be E.164' })
  recipientAltPhoneE164?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  recipientEmail?: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  recipientAddressLine1!: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipientAddressLine2?: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipientLandmark?: string;

  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  recipientCity!: string;

  @ApiProperty({
    maxLength: 80,
    description: 'Indian state/UT; validated soft against ops.allowed_indian_states.',
  })
  @IsString()
  @MaxLength(80)
  recipientStateProvince!: string;

  @ApiProperty({ example: '560001', description: 'Indian PIN (6 digits, first 1-9).' })
  @IsString()
  @MaxLength(12)
  recipientPostalCode!: string;

  @ApiProperty({
    required: false,
    default: 'IN',
    description: 'Phase 1A ships to India only.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  recipientCountryCode?: string;

  // ── Economics / physical ────────────────────────────────────────────

  @ApiProperty({ enum: PaymentMode })
  @IsEnum(PaymentMode)
  paymentMode!: PaymentMode;

  @ApiProperty({
    required: false,
    minimum: 0,
    description: 'Required (> 0) when paymentMode = COD; must be absent for PREPAID.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  codAmountInr?: number;

  @ApiProperty({
    required: false,
    minimum: 0,
    description:
      'Customs declared value (INR). Defaults to Σ(item declared value × qty) from catalog snapshots when omitted.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  declaredValueInr?: number;

  @ApiProperty({
    required: false,
    minimum: 0,
    description: 'Defaults to Σ(item weight × qty) when every item weight is known, else null.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalWeightGrams?: number;

  @ApiProperty({ required: false, enum: PackageType })
  @IsOptional()
  @IsEnum(PackageType)
  packageType?: PackageType;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isUrgent?: boolean;

  // ── Customer profile (optional; recipient is the fallback) ───────────

  @ApiProperty({ required: false, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  customerName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  customerEmail?: string;

  @ApiProperty({ required: false, enum: ['en', 'hi'], default: 'en' })
  @IsOptional()
  @IsString()
  @Matches(/^(en|hi)$/, { message: 'preferredLanguage must be "en" or "hi"' })
  preferredLanguage?: string;

  // ── Notes ───────────────────────────────────────────────────────────

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sellerNotes?: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNotes?: string;

  // ── Lines ───────────────────────────────────────────────────────────

  @ApiProperty({ type: [CreateOrderItemDto], minItems: 1, maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
