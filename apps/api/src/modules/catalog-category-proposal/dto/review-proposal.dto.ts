import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { AttributeValueType, CategoryProposalStatus, PackageType } from '@skydrop/db';
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
  ValidateNested,
} from 'class-validator';

const ATTRIBUTE_KEY = /^[a-z][a-z0-9_]*$/;

export class ApprovalAttributeDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(ATTRIBUTE_KEY, {
    message: 'attributeKey must be lowercase, start with a letter, snake_case',
  })
  attributeKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayLabel!: string;

  @ApiProperty({ enum: AttributeValueType })
  @IsEnum(AttributeValueType)
  valueType!: AttributeValueType;

  @ApiProperty({ required: false, type: [String] })
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

export class ApproveProposalDto {
  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  decisionNote?: string;

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
    minimum: 0,
    maximum: 100,
    description: 'Whole percent only in Phase 1A (India GST is integral: 5/12/18/28)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  defaultGstRate?: number;

  @ApiProperty({ required: false, type: [ApprovalAttributeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ApprovalAttributeDto)
  attributeDefinitions?: ApprovalAttributeDto[];
}

export class RejectProposalDto {
  @ApiProperty({ minLength: 2, maxLength: 2000, description: 'Reason shown to the seller' })
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  decisionNote!: string;
}

export class ListAllProposalsQueryDto {
  @ApiProperty({ required: false, enum: CategoryProposalStatus })
  @IsOptional()
  @IsEnum(CategoryProposalStatus)
  status?: CategoryProposalStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sellerId?: string;

  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
