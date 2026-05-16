import { ApiProperty } from '@nestjs/swagger';
import { PackageType } from '@skydrop/db';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Partial update. `slug` and `parentId` are intentionally NOT updatable
 * here — slug is a stable external identifier and re-parenting goes
 * through the dedicated move endpoint (which handles fullPath/depth
 * recomputation + cycle prevention).
 */
export class UpdateCategoryDto {
  @ApiProperty({ required: false, minLength: 1, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({ required: false, nullable: true, enum: PackageType })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(PackageType)
  defaultPackageType?: PackageType | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  requiresFragile?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  requiresColdChain?: boolean;

  @ApiProperty({ required: false, nullable: true, maxLength: 16 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(16)
  defaultHsCode?: string | null;

  @ApiProperty({ required: false, nullable: true, minimum: 0, maximum: 100 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(100)
  defaultGstRate?: number | null;
}
