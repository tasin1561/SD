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

  @ApiProperty({ enum: BinType })
  @IsEnum(BinType)
  type!: BinType;

  // The code is NOT accepted from the client — it is composed from the
  // three coordinates below (see bin-code.ts). Free-typed codes are how
  // one shelf ends up as `A-01-03`, `A-1-3` and `a01-03`.
  @ApiProperty({ description: 'Aisle: 1–2 letters, e.g. A or AB' })
  @IsString()
  @MinLength(1)
  @MaxLength(2)
  @Matches(/^[A-Za-z]{1,2}$/, { message: 'aisle must be 1–2 letters' })
  aisle!: string;

  @ApiProperty({ description: 'Rack: 1–3 digits, zero-padded to 2 on save' })
  @IsString()
  @Matches(/^\d{1,3}$/, { message: 'rack must be 1–3 digits' })
  rack!: string;

  @ApiProperty({ description: 'Shelf: 1–3 digits, zero-padded to 2 on save' })
  @IsString()
  @Matches(/^\d{1,3}$/, { message: 'shelf must be 1–3 digits' })
  shelf!: string;

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
  @ApiProperty({
    required: false,
    description: 'Move the bin to a different zone in the same warehouse',
  })
  @IsOptional()
  @IsUUID('7')
  zoneId?: string;

  @ApiProperty({ required: false, enum: BinType })
  @IsOptional()
  @IsEnum(BinType)
  type?: BinType;

  // Coordinates are all-or-nothing on update: the code is derived from
  // all three, so changing one alone would leave the code disagreeing
  // with the fields it was built from.
  @ApiProperty({ required: false, description: 'Aisle: 1–2 letters' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{1,2}$/, { message: 'aisle must be 1–2 letters' })
  aisle?: string;

  @ApiProperty({ required: false, description: 'Rack: 1–3 digits' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,3}$/, { message: 'rack must be 1–3 digits' })
  rack?: string;

  @ApiProperty({ required: false, description: 'Shelf: 1–3 digits' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,3}$/, { message: 'shelf must be 1–3 digits' })
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
