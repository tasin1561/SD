import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { OrderCancellationReason, OrderStatus, PackageType, PaymentMode } from '@skydrop/db';
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * God-mode field whitelist. Identity / system-managed columns
 * (id, orderNumber, sellerId, customerId, source, status,
 * hasAdminOverride, createdAt/updatedAt/placedAt) are intentionally
 * absent — status moves via `targetStatus`; hasAdminOverride is set by
 * the service and NEVER cleared.
 */
export class ForceMutationFieldsDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() recipientName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() recipientPhoneE164?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() recipientAltPhoneE164?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() recipientEmail?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() recipientAddressLine1?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() recipientAddressLine2?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() recipientLandmark?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() recipientCity?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() recipientStateProvince?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() recipientPostalCode?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() recipientCountryCode?: string;

  @ApiProperty({ required: false, enum: PaymentMode })
  @IsOptional() @IsEnum(PaymentMode) paymentMode?: PaymentMode;

  @ApiProperty({ required: false })
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) codAmountInr?: number;

  @ApiProperty({ required: false })
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) declaredValueInr?: number;

  @ApiProperty({ required: false })
  @IsOptional() @Type(() => Number) @IsInt() totalWeightGrams?: number;

  @ApiProperty({ required: false, enum: PackageType })
  @IsOptional() @IsEnum(PackageType) packageType?: PackageType;

  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isUrgent?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isHighRisk?: boolean;

  @ApiProperty({ required: false }) @IsOptional() @IsString() sellerNotes?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() internalNotes?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() callNotes?: string;

  @ApiProperty({ required: false, enum: OrderCancellationReason })
  @IsOptional() @IsEnum(OrderCancellationReason) cancellationReason?: OrderCancellationReason;
}

/**
 * ORD-2 god mode. Single dedicated route, deliberately hostile to
 * accidental use: a meaningful reason AND a literal-true risk
 * acknowledgement are both mandatory, and at least one of fieldChanges /
 * targetStatus must be present. The service re-validates all three
 * (defense in depth).
 */
export class ForceMutationDto {
  @ApiProperty({ required: false, type: ForceMutationFieldsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ForceMutationFieldsDto)
  fieldChanges?: ForceMutationFieldsDto;

  @ApiProperty({ required: false, enum: OrderStatus, description: 'Bypasses the state machine.' })
  @IsOptional()
  @IsEnum(OrderStatus)
  targetStatus?: OrderStatus;

  @ApiProperty({ minLength: 30, description: 'Why the bypass is justified (audited, CRITICAL).' })
  @IsString()
  @MinLength(30, { message: 'reason must be at least 30 characters' })
  reason!: string;

  @ApiProperty({
    enum: [true],
    description: 'Must be the literal boolean true — explicit data-integrity-risk acknowledgement.',
  })
  @IsBoolean()
  @Equals(true, { message: 'acknowledgeDataIntegrityRisk must be the literal boolean true' })
  acknowledgeDataIntegrityRisk!: boolean;
}
