import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PresignOrderCsvDto {
  @ApiProperty({ example: 'orders-batch.csv' })
  @IsString()
  @MaxLength(255)
  @Matches(/\.csv$/i, { message: 'fileName must end in .csv' })
  fileName!: string;
}

export class PreviewOrderCsvDto {
  @ApiProperty({ description: 'spacesKey returned by the presign call' })
  @IsString()
  @MaxLength(512)
  spacesKey!: string;

  @ApiProperty({
    required: false,
    additionalProperties: true,
    description: 'Optional manual mapping override (order field → CSV header), merged over auto-detect.',
  })
  @IsOptional()
  @IsObject()
  mappingOverride?: Record<string, string>;
}

export class ProcessOrderCsvDto {
  @ApiProperty({ description: 'spacesKey returned by the presign call' })
  @IsString()
  @MaxLength(512)
  spacesKey!: string;

  @ApiProperty({ example: 'orders-batch.csv' })
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({
    required: false,
    additionalProperties: true,
    description: 'Optional manual mapping override (order field → CSV header)',
  })
  @IsOptional()
  @IsObject()
  mappingOverride?: Record<string, string>;
}

export class ListOrderCsvUploadsQueryDto {
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
