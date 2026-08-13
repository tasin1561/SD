import { ApiProperty } from '@nestjs/swagger';
import { InventoryMode } from '@skydrop/db';
import { IsDefined, IsEnum, ValidateIf } from 'class-validator';

/**
 * R4 — set or clear a variant's inventory mode.
 *
 * `null` is a REAL state and not a synonym for NORMAL: it clears the
 * variant's own value so the SKU inherits the seller's
 * `inventory.default_inventory_mode` setting again. A seller who flips
 * their whole catalogue to STRICT must be able to put one SKU back on
 * "whatever the catalogue does" without pinning it to NORMAL forever.
 *
 * The key MUST be present — `@IsDefined` under `@ValidateIf` rejects
 * `undefined` while allowing an explicit `null` (same shape as
 * SetVariantThresholdDto, which solves the identical clear-vs-omit
 * problem).
 */
export class SetVariantInventoryModeDto {
  @ApiProperty({
    enum: InventoryMode,
    nullable: true,
    description:
      "Per-variant inventory mode; null clears it so the SKU inherits the seller's default",
  })
  @ValidateIf((_o, v) => v !== null)
  @IsDefined()
  @IsEnum(InventoryMode)
  inventoryMode!: InventoryMode | null;
}
