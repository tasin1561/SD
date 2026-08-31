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

  /**
   * WHO is carrying it — Bluedart, DTDC, the shop on the corner.
   *
   * REQUIRED, and that is the point. `courierCode` becomes the literal
   * 'manual' for these parcels (CUR-8), so this is the only place the
   * carrier's name exists — and the seller's tracking screen and the
   * public tracking page both read it. Optional, it was routinely left
   * blank, and a seller chasing their parcel was told it was with a
   * courier called "manual". The operator has just booked the thing;
   * they know who has it.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  courierName!: string;

  /** Their service tier, if it matters later. Its own column — it used
   *  to share one with `courierName`, which meant filling this in threw
   *  the carrier away. */
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
