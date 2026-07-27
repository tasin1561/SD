import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const DOC_TYPES = [
  'EPOD',
  'SIGNATURE_URL',
  'RVP_QC_IMAGE',
  'SELLER_RETURN_IMAGE',
] as const;

export class ShipmentInsightQueryDto {
  @ApiPropertyOptional({
    enum: ['S', 'E', 'N'],
    description:
      'Transport mode for the TAT quote: S surface (default), E express, N none.',
  })
  @IsOptional()
  @IsIn(['S', 'E', 'N'])
  readonly mode?: 'S' | 'E' | 'N';
}

export class FetchDocumentQueryDto {
  @ApiProperty({
    enum: DOC_TYPES,
    description:
      'EPOD and SIGNATURE_URL settle a "never received it" dispute; the QC image covers a reverse pickup.',
  })
  @IsIn(DOC_TYPES)
  readonly docType!: (typeof DOC_TYPES)[number];
}

export class EditShipmentDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  readonly name?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  readonly phone?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly address?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  readonly productsDesc?: string;
}

export class CancelWithCourierDto {
  @ApiProperty({
    minLength: 10,
    description:
      'Why the parcel is being pulled. A parcel already moving becomes a RETURN rather than disappearing, so this is a costed decision worth explaining.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  readonly reason!: string;
}

export class AttachEwaybillDto {
  @ApiProperty({ description: 'Invoice the e-way bill was raised against.' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  readonly invoiceNumber!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  readonly ewaybillNumber!: string;
}

export class NdrActionDto {
  @ApiProperty({
    enum: ['RE-ATTEMPT', 'PICKUP_RESCHEDULE'],
    description:
      'RE-ATTEMPT asks for another delivery run; PICKUP_RESCHEDULE re-books a reverse pickup.',
  })
  @IsIn(['RE-ATTEMPT', 'PICKUP_RESCHEDULE'])
  readonly action!: 'RE-ATTEMPT' | 'PICKUP_RESCHEDULE';
}

export class RaisePickupDto {
  @ApiProperty({ description: 'Warehouse the van should come to.' })
  @IsUUID('7')
  readonly warehouseId!: string;

  @ApiProperty({
    description:
      'YYYY-MM-DD. Delhivery accepts one open request per location per day, so this is the slot being claimed.',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'pickupDate must be YYYY-MM-DD' })
  readonly pickupDate!: string;

  @ApiProperty({ description: 'HH:mm:ss, local to the warehouse.' })
  @Matches(/^\d{2}:\d{2}:\d{2}$/, { message: 'pickupTime must be HH:mm:ss' })
  readonly pickupTime!: string;

  @ApiProperty({
    minimum: 1,
    description:
      'How many parcels will be handed over. One request covers the whole handover — do not raise one per parcel.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  readonly expectedPackageCount!: number;
}

export class ClosePickupDto {
  @ApiProperty({ enum: ['CLOSED', 'CANCELLED', 'FAILED'] })
  @IsIn(['CLOSED', 'CANCELLED', 'FAILED'])
  readonly status!: 'CLOSED' | 'CANCELLED' | 'FAILED';
}

export class ReleasePickupDayDto {
  @ApiProperty({
    minLength: 10,
    description:
      'Why the day is being freed. Only do this after confirming in the courier panel that no request exists — otherwise a second van is booked.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  readonly reason!: string;
}

export class MarginReportQueryDto {
  @ApiPropertyOptional({ description: 'ISO date. Defaults to 30 days ago.' })
  @IsOptional()
  @IsDateString()
  readonly from?: string;

  @ApiPropertyOptional({ description: 'ISO date. Defaults to now.' })
  @IsOptional()
  @IsDateString()
  readonly to?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    description:
      'How many shipments to price. Each costs one live courier call against a rate-limited endpoint, so this is capped — the report reports what it skipped.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly limit?: number;
}

export class RegisterCourierWarehouseDto {
  @ApiProperty({
    description:
      'THE load-bearing string. Matched exactly (case and spaces) on every shipment create, and immutable once registered.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  readonly name!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  readonly phone!: string;

  @ApiProperty()
  @Matches(/^\d{6}$/, { message: 'pin must be 6 digits' })
  readonly pin!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  readonly email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  readonly registeredName?: string;

  @ApiProperty({ description: 'Where undelivered parcels come back to.' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  readonly returnAddress!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly returnCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'returnPin must be 6 digits' })
  readonly returnPin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly returnState?: string;
}
