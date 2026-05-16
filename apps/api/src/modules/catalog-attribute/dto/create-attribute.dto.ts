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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const ATTRIBUTE_KEY = /^[a-z][a-z0-9_]*$/;

export class CreateAttributeDefinitionDto {
  @ApiProperty({ example: 'color', description: 'Stable key, lowercase snake' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(ATTRIBUTE_KEY, {
    message: 'attributeKey must be lowercase, start with a letter, snake_case',
  })
  attributeKey!: string;

  @ApiProperty({ example: 'Colour' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayLabel!: string;

  @ApiProperty({ enum: AttributeValueType })
  @IsEnum(AttributeValueType)
  valueType!: AttributeValueType;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Required (non-empty) when valueType=ENUM; ignored otherwise',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  allowedValues?: string[];

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiProperty({ required: false, default: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  displayOrder?: number;
}
