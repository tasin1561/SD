import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Partial update. `skuCode` is updatable but still per-seller unique.
 * `status` is NOT here — use archive/unarchive. If `attributes` is
 * provided it fully replaces the prior map and is re-validated against
 * the effective attribute set.
 */
export class UpdateVariantDto {
  @ApiProperty({ required: false, minLength: 1, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  skuCode?: string;

  @ApiProperty({ required: false, additionalProperties: true })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiProperty({ required: false, nullable: true, maxLength: 120 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  variantLabel?: string | null;

  @ApiProperty({ required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  weightGrams?: number | null;

  @ApiProperty({ required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  lengthCm?: number | null;

  @ApiProperty({ required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  widthCm?: number | null;

  @ApiProperty({ required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  heightCm?: number | null;

  @ApiProperty({ required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  declaredValueInr?: number | null;

  @ApiProperty({ required: false, nullable: true, minimum: 0, maximum: 100 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  gstRate?: number | null;

  @ApiProperty({ required: false, nullable: true, maxLength: 64 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  @ApiProperty({ required: false, nullable: true, maxLength: 120 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  externalSku?: string | null;
}
