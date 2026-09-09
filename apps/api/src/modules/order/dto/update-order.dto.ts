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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateOrderItemDto } from './create-order.dto';

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * State-dependent edit (ORD-6 corrective path). The service enforces:
 *  - DRAFT and PENDING_CONFIRMATION → every field below is editable,
 *    `items` as a full replace re-snapshotted from the catalogue. The
 *    whole order is editable until the confirmation call settles it,
 *    because nothing is committed before CONFIRMED (no reservation,
 *    ORD-10; no waybill, CUR-2b; no shipment).
 *  - EXCEPT under a live call: an items or economics edit is refused
 *    while an agent is holding the order (EDIT_DURING_CALL). Waiting in
 *    the queue is not a call. A recipient correction is always allowed.
 *  - any other status → 409 (god-mode is a separate, non-Checkpoint-2
 *    path).
 *
 * Every property is optional; only provided keys are touched (PATCH
 * semantics). Recipient changes re-run AddressValidationService and
 * re-resolve the per-seller customer when the phone changes (ORD-7).
 */
export class UpdateOrderDto {
  @ApiProperty({ required: false, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  recipientName?: string;

  @ApiProperty({ required: false, example: '+919876543210' })
  @IsOptional()
  @IsString()
  @Matches(E164, { message: 'recipientPhoneE164 must be E.164' })
  recipientPhoneE164?: string;

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

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipientAddressLine1?: string;

  @ApiProperty({
    required: false,
    maxLength: 200,
    description:
      'The landmark. Optional to SEND, but may not be blanked — it is required on create.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'recipientAddressLine2 (landmark) may not be cleared' })
  @MaxLength(200)
  recipientAddressLine2?: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipientLandmark?: string;

  @ApiProperty({ required: false, maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipientCity?: string;

  @ApiProperty({ required: false, maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipientStateProvince?: string;

  @ApiProperty({ required: false, example: '560001' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  recipientPostalCode?: string;

  // ── Economics / physical (until the call confirms it) ───────────────

  @ApiProperty({ required: false, enum: PaymentMode })
  @IsOptional()
  @IsEnum(PaymentMode)
  paymentMode?: PaymentMode;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  codAmountInr?: number;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  declaredValueInr?: number;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalWeightGrams?: number;

  @ApiProperty({ required: false, enum: PackageType })
  @IsOptional()
  @IsEnum(PackageType)
  packageType?: PackageType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isUrgent?: boolean;

  /*
    THE REST OF THE MONEY (2026-09-09).

    These five were on CREATE and not on UPDATE, so a seller editing an
    order could change the COD figure but not the advance it was derived
    from, could not move an order to another shopfront, and could not
    correct the reference their own shop had emitted. The create form
    asks for all of them; the edit form asking for fewer made "edit"
    mean something different from "create" for no stated reason.
  */

  /** Paid up front, so the collectable is the rest. */
  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  advanceAmountInr?: number;

  /** What the seller charges the CUSTOMER for delivery — their own
   *  figure, unrelated to what we charge the seller. */
  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  deliveryFeeInr?: number;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountInr?: number;

  /**
   * The seller's own reference. `(sellerId, storeId, sellerOrderRef)` is
   * UNIQUE, so a clash is a real 409 rather than a silent overwrite.
   */
  @ApiProperty({ required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sellerOrderRef?: string;

  /** Which shopfront the order belongs to. */
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID('7')
  storeId?: string;

  // ── Notes (editable in DRAFT + PENDING_CONFIRMATION) ────────────────

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

  // ── Lines (full replace, until the call confirms it) ────────────────

  @ApiProperty({
    required: false,
    type: [CreateOrderItemDto],
    minItems: 1,
    maxItems: 200,
    description: 'When present, replaces the entire line set. Refused mid-call (EDIT_DURING_CALL).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items?: CreateOrderItemDto[];
}
