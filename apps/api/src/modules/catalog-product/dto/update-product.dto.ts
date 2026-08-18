import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Partial update. `status` is NOT updatable here — lifecycle transitions
 * go through the dedicated archive/unarchive endpoints. `externalRef` is
 * updatable but still subject to the per-seller uniqueness constraint.
 */
export class UpdateProductDto {
  @ApiProperty({ required: false, minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiProperty({ required: false, nullable: true, maxLength: 4000 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiProperty({ required: false, nullable: true, maxLength: 120 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  externalRef?: string | null;

  @ApiProperty({ required: false, nullable: true, maxLength: 120 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  @ApiProperty({ required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  defaultWeightGrams?: number | null;

  @ApiProperty({ required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultLengthCm?: number | null;

  @ApiProperty({ required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultWidthCm?: number | null;

  @ApiProperty({ required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultHeightCm?: number | null;

  @ApiProperty({ required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  defaultDeclaredValueInr?: number | null;
}
