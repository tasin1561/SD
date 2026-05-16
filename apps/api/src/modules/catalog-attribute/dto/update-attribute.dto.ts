import { ApiProperty } from '@nestjs/swagger';
import { AttributeValueType } from '@skydrop/db';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Partial update. `attributeKey` is NOT updatable — it is the attribute's
 * identity within the category (unique [categoryId, attributeKey]) and is
 * referenced by variant attribute payloads. Re-key = delete + recreate.
 */
export class UpdateAttributeDefinitionDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayLabel?: string;

  @ApiProperty({ required: false, enum: AttributeValueType })
  @IsOptional()
  @IsEnum(AttributeValueType)
  valueType?: AttributeValueType;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  allowedValues?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  displayOrder?: number;
}
