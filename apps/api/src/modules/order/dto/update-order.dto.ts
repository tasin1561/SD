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
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateOrderItemDto } from './create-order.dto';

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * State-dependent edit (ORD-6 corrective path). The service enforces:
 *  - DRAFT → every field below is editable (incl. `items`, full replace,
 *    re-snapshotted from the catalog).
 *  - PENDING_CONFIRMATION → ONLY recipient/customer corrections + notes;
 *    `items` and economics are rejected (call-centre correction window).
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

  // ── Economics / physical (DRAFT only) ───────────────────────────────

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

  // ── Lines (DRAFT only — full replace) ───────────────────────────────

  @ApiProperty({
    required: false,
    type: [CreateOrderItemDto],
    minItems: 1,
    maxItems: 200,
    description: 'When present, replaces the entire line set (DRAFT only).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items?: CreateOrderItemDto[];
}
