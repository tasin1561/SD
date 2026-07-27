import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Module 9 commit 14 — manual courier placement DTOs (CUR-8).
 */

/** Record a manually-arranged courier AWB on a shipment whose order is
 *  PENDING_MANUAL_PLACEMENT. The operator placed the parcel with a
 *  non-integrated courier out of band and types its AWB back in. */
export class PlaceManualAwbDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  awbNumber!: string;

  /** Free-text name of the actual carrier (Bluedart / DTDC / …). The
   *  shipment's courierCode is set to the generic `manual` courier;
   *  this is recorded for ops reference. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  courierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  serviceType?: string;
}

/** Cancel an order that cannot be fulfilled by any courier. */
export class CancelUnfulfillableDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
