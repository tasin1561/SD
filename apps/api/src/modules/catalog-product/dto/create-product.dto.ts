import { ApiProperty } from '@nestjs/swagger';
import { ProductStatus } from '@skydrop/db';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ required: false, maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @ApiProperty({
    required: false,
    maxLength: 120,
    description: "Seller's own product id; unique per seller",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalRef?: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalSku?: string;

  @ApiProperty({ required: false, minimum: 0, description: 'Default weight in grams' })
  @IsOptional()
  @IsInt()
  @Min(0)
  defaultWeightGrams?: number;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultLengthCm?: number;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultWidthCm?: number;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultHeightCm?: number;

  @ApiProperty({ required: false, minimum: 0, description: 'Default declared value (INR)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultDeclaredValueInr?: number;

  @ApiProperty({
    required: false,
    enum: [ProductStatus.ACTIVE, ProductStatus.DRAFT],
    default: ProductStatus.ACTIVE,
    description: 'Initial status — ACTIVE or DRAFT. Archiving is a separate action.',
  })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
