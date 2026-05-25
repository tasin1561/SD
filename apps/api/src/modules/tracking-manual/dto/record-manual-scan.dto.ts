import { ApiProperty } from '@nestjs/swagger';
import { DeliveryFailureReason, ShipmentStatus } from '@skydrop/db';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * The ShipmentStatus values an operator is allowed to log as a manual
 * scan. Mirrors the TrackingStatusMappingService TRANSITION /
 * DELIVERY_ATTEMPT / INFORMATIONAL allowlist — REJECT values (the
 * pre-dispatch internals CREATED / AWB_PENDING / AWB_GENERATED /
 * FAILED_AT_CREATION / HANDED_TO_COURIER / AT_HUB / CANCELLED) are
 * NOT manual-loggable: they are internal lifecycle states the
 * operator should never assert via a tracking scan. The mapping
 * service would REJECT them anyway; the DTO enforces it at the
 * validation layer for a friendlier 400.
 *
 * Implementing this as a TypeScript literal-union string-array and
 * casting to ShipmentStatus keeps class-validator's @IsEnum happy
 * (we can't use Pick<> on the enum at runtime).
 */
const MANUAL_SCAN_STATUS_VALUES = [
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.DELIVERED,
  ShipmentStatus.DELIVERY_ATTEMPTED,
  ShipmentStatus.RTO_INITIATED,
  ShipmentStatus.RTO_IN_TRANSIT,
  ShipmentStatus.RTO_DELIVERED,
  ShipmentStatus.LOST,
  ShipmentStatus.DAMAGED,
] as const;

const ManualScanStatusEnum = Object.fromEntries(
  MANUAL_SCAN_STATUS_VALUES.map((v) => [v, v] as const),
);

export class RecordManualScanDto {
  @ApiProperty({
    enum: MANUAL_SCAN_STATUS_VALUES,
    description:
      'The scan status the operator is recording. Pre-dispatch internal statuses are not manual-loggable.',
  })
  @IsEnum(ManualScanStatusEnum)
  status!: ShipmentStatus;

  @ApiProperty({
    description:
      'Scan time the operator is recording, ISO 8601 UTC. TRK-3: this becomes tracking_events.event_at; never replaced with the receive time. Backfills are intentional (a late-recorded manual scan still lands in the correct timeline position).',
    example: '2026-05-20T10:00:00.000Z',
  })
  @IsISO8601()
  eventAtIso!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  locationName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  locationCity?: string;

  @ApiProperty({ required: false, description: '6-digit Indian PIN' })
  @IsOptional()
  @Matches(/^\d{6}$/)
  locationPincode?: string;

  @ApiProperty({
    required: false,
    enum: DeliveryFailureReason,
    description:
      'Only meaningful when status=DELIVERY_ATTEMPTED. The manual-scan service writes a delivery_attempts row in that case and stamps this as the failureReason.',
  })
  @IsOptional()
  @IsEnum(DeliveryFailureReason)
  failureReason?: DeliveryFailureReason;

  @ApiProperty({
    required: false,
    default: true,
    description:
      'Whether the public tracking page should surface this scan. Defaults true. Set false for diagnostic / ops-only scans.',
  })
  @IsOptional()
  @IsBoolean()
  isVisibleToCustomer?: boolean;
}
