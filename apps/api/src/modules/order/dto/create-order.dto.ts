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
  IsNotEmpty,
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
    description:
      'Which shopfront this sale came from. Omit for the seller’s default store — which is what a CSV row with no store column gets.',
  })
  @IsOptional()
  @IsUUID('7')
  storeId?: string;

  @ApiProperty({
    required: false,
    maxLength: 120,
    description:
      "Seller's own order id. Unique per STORE, not per seller: two shopfronts each running their own Shopify both emit `#1001`.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sellerOrderRef?: string;

  /**
   * Order page v2 — the address check this order was filled in with.
   *
   * OPTIONAL and additive: the old page does not send it and behaves
   * exactly as it always has. Its PRESENCE is what marks the order as
   * v2 (`orders.created_via`), so there is no second field the two
   * pages could disagree about, and no way for an order to claim a
   * check it does not have.
   *
   * An unknown or already-used reference is IGNORED rather than
   * refused: the check is advice about a delivery, and an order must
   * never fail to save over the bookkeeping of the advice.
   */
  @ApiProperty({
    required: false,
    maxLength: 64,
    description:
      'The draft id of this order’s address check, from the new order page. Ignored when it names no check.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^draft-[A-Za-z0-9-]{8,}$/, { message: 'must look like draft-<uuid>' })
  addressCheckReferenceId?: string;

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

  @ApiProperty({
    maxLength: 200,
    description: 'The landmark. Required — a parcel without one is materially harder to deliver.',
  })
  @IsString()
  @IsNotEmpty({ message: 'recipientAddressLine2 (landmark) is required' })
  @MaxLength(200)
  recipientAddressLine2!: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipientLandmark?: string;

  @ApiProperty({
    required: false,
    maxLength: 80,
    description:
      'Optional. Delhivery routes on the PIN and resolves the locality itself, so the seller form no longer asks. Stored as an empty string when absent.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipientCity?: string;

  @ApiProperty({
    required: false,
    maxLength: 80,
    description:
      'Optional. When supplied it is still validated soft against ops.allowed_indian_states (ORD-5); when absent that check cannot run.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipientStateProvince?: string;

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
    description: 'Money already taken from the customer, deducted from the collectable amount.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  advanceAmountInr?: number;

  @ApiProperty({
    required: false,
    minimum: 0,
    description:
      "What the customer is charged for delivery, added to the collectable amount. The seller's " +
      'own figure — the platform fee they pay us is separate and unaffected.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  deliveryFeeInr?: number;

  @ApiProperty({
    required: false,
    description:
      'Deducted from the collectable amount. May be NEGATIVE, which is a surcharge — the ' +
      'field absorbs a manual edit of the collectable in either direction.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  discountInr?: number;

  @ApiProperty({
    required: false,
    minimum: 0,
    description:
      'Customs declared value (INR). NOT the collectable amount — this goes to the courier as ' +
      'the parcel value and triggers the e-waybill above 50,000. Defaults to Σ(item declared ' +
      'value × qty) from catalog snapshots when omitted.',
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

  @ApiProperty({
    required: false,
    description:
      'Set true to place the order even though this customer has an unpacked order already. Recorded on the order, so a later dispute has an answer.',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeDuplicate?: boolean;

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
