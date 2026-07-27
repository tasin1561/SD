import { ApiProperty } from '@nestjs/swagger';
import { PackageType } from '@skydrop/db';
import {
  IsBoolean,
  IsEnum,
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

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateCategoryDto {
  @ApiProperty({ example: 'Apparel', minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'apparel', description: 'Globally unique, lowercase kebab' })
  @IsString()
  @MinLength(1)
  @MaxLength(140)
  @Matches(SLUG, { message: 'slug must be lowercase alphanumeric with single hyphens' })
  slug!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Parent category id; omit/null = root',
  })
  @IsOptional()
  @IsUUID('7')
  parentId?: string;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({ required: false, enum: PackageType })
  @IsOptional()
  @IsEnum(PackageType)
  defaultPackageType?: PackageType;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  requiresFragile?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  requiresColdChain?: boolean;

  @ApiProperty({ required: false, maxLength: 16 })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  defaultHsCode?: string;

  @ApiProperty({
    required: false,
    description: 'Percent, 0–100, up to 2dp',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsInt({ message: 'defaultGstRate must be an integer or omitted (whole-percent in Phase 1A)' })
  @Min(0)
  @Max(100)
  defaultGstRate?: number;
}
