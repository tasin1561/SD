import { ApiProperty } from '@nestjs/swagger';
import { CsvImportType } from '@skydrop/db';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCsvMappingDto {
  @ApiProperty({ example: 'Shopify export', maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    enum: CsvImportType,
    default: CsvImportType.PRODUCT_VARIANT,
    required: false,
    description: 'Only PRODUCT_VARIANT is supported in Phase 1A',
  })
  @IsOptional()
  @IsEnum(CsvImportType)
  importType?: CsvImportType;

  @ApiProperty({
    additionalProperties: true,
    description:
      'Catalog field → CSV header. Keys must be known catalog target ' +
      'fields (e.g. productName, variantSkuCode); values are the exact ' +
      'header strings in the seller’s CSV.',
    example: { productName: 'Title', variantSkuCode: 'SKU' },
  })
  @IsObject()
  columnMap!: Record<string, string>;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateCsvMappingDto {
  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiProperty({ required: false, additionalProperties: true })
  @IsOptional()
  @IsObject()
  columnMap?: Record<string, string>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
