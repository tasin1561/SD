import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { BinType } from '@skydrop/db';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateBinDto {
  @ApiProperty({ description: 'Owning zone id (must belong to the warehouse)' })
  @IsUUID('7')
  zoneId!: string;

  @ApiProperty({ description: 'Full hierarchical bin code, unique within the warehouse, e.g. "A-1-2-03"', maxLength: 48 })
  @IsString()
  @MinLength(1)
  @MaxLength(48)
  @Matches(/^[A-Z0-9-]+$/, { message: 'code must be uppercase alphanumeric/dash' })
  code!: string;

  @ApiProperty({ enum: BinType })
  @IsEnum(BinType)
  type!: BinType;

  @ApiProperty({ required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  aisle?: string;

  @ApiProperty({ required: false, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  shelf?: string;

  @ApiProperty({ required: false, minimum: 0, description: 'Phase 2 capacity cap (kg)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxWeightKg?: number;

  @ApiProperty({ required: false, minimum: 0, description: 'Phase 2 capacity cap (cm^3)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxVolumeCm3?: number;
}

export class UpdateBinDto {
  @ApiProperty({ required: false, description: 'Move the bin to a different zone in the same warehouse' })
  @IsOptional()
  @IsUUID('7')
  zoneId?: string;

  @ApiProperty({ required: false, enum: BinType })
  @IsOptional()
  @IsEnum(BinType)
  type?: BinType;

  @ApiProperty({ required: false, maxLength: 32, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  aisle?: string;

  @ApiProperty({ required: false, maxLength: 32, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  shelf?: string;

  @ApiProperty({ required: false, minimum: 0, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxWeightKg?: number;

  @ApiProperty({ required: false, minimum: 0, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxVolumeCm3?: number;
}

export class ListBinsQueryDto {
  @ApiProperty({ required: false, description: 'Filter by zone' })
  @IsOptional()
  @IsUUID('7')
  zoneId?: string;

  @ApiProperty({ required: false, enum: BinType })
  @IsOptional()
  @IsEnum(BinType)
  type?: BinType;
}
