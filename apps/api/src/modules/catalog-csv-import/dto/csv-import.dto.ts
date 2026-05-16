import { ApiProperty } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class PresignCsvDto {
  @ApiProperty({ example: 'my-catalog.csv' })
  @IsString()
  @MaxLength(255)
  @Matches(/\.csv$/i, { message: 'fileName must end in .csv' })
  fileName!: string;
}

export class PreviewCsvDto {
  @ApiProperty({ description: 'spacesKey returned by the presign call' })
  @IsString()
  @MaxLength(512)
  spacesKey!: string;

  @ApiProperty({
    required: false,
    description:
      'Optional saved-mapping id. Its columnMap is layered over ' +
      'auto-detection (and under any mappingOverride).',
  })
  @IsOptional()
  @IsUUID('7')
  mappingId?: string;

  @ApiProperty({
    required: false,
    additionalProperties: true,
    description:
      'Optional manual mapping override (catalog field → CSV header). ' +
      'Merged over auto-detection so a seller can correct mis-detected columns.',
  })
  @IsOptional()
  @IsObject()
  mappingOverride?: Record<string, string>;
}

export class ProcessCsvDto {
  @ApiProperty({ description: 'spacesKey returned by the presign call' })
  @IsString()
  @MaxLength(512)
  spacesKey!: string;

  @ApiProperty({ example: 'my-catalog.csv' })
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({
    required: false,
    description:
      'Optional saved-mapping id. Its columnMap is layered over ' +
      'auto-detection (and under any mappingOverride); the import is ' +
      'tagged with this mapping and its lastUsedAt is bumped.',
  })
  @IsOptional()
  @IsUUID('7')
  mappingId?: string;

  @ApiProperty({
    required: false,
    additionalProperties: true,
    description: 'Optional manual mapping override (catalog field → CSV header)',
  })
  @IsOptional()
  @IsObject()
  mappingOverride?: Record<string, string>;
}
