import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsInt, Max, Min, ValidateIf } from 'class-validator';

/**
 * `null` explicitly clears the threshold (falls back to the next level in
 * the chain). The key MUST be present — `@IsDefined` under `@ValidateIf`
 * rejects `undefined` while allowing an explicit `null`.
 */
export class SetDefaultThresholdDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 1_000_000,
    description: 'Per-seller default low-stock threshold; null clears it',
  })
  @ValidateIf((_o, v) => v !== null)
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  defaultLowStockThreshold!: number | null;
}

export class SetVariantThresholdDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 1_000_000,
    description: 'Per-variant low-stock threshold (wins over seller default); null clears it',
  })
  @ValidateIf((_o, v) => v !== null)
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  lowStockThreshold!: number | null;
}
