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
} from 'class-validator';

export class CreateVariantDto {
  @ApiProperty({ minLength: 1, maxLength: 120, description: 'SKU code; unique per seller' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  skuCode!: string;

  @ApiProperty({
    required: false,
    additionalProperties: true,
    description:
      'Free-form attribute map (e.g. colour, size). Keys are strings; ' +
      'values must be primitives (string/number/boolean). Defaults to {}.',
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  variantLabel?: string;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  weightGrams?: number;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  lengthCm?: number;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  widthCm?: number;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  heightCm?: number;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  declaredValueInr?: number;

  @ApiProperty({ required: false, maxLength: 16 })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  hsCode?: string;

  @ApiProperty({
    required: false,
    minimum: 0,
    maximum: 100,
    description: 'Whole percent only in Phase 1A',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  gstRate?: number;

  @ApiProperty({ required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalSku?: string;
}
