import { ApiProperty } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
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
    additionalProperties: true,
    description:
      'Optional manual mapping override (catalog field → CSV header). ' +
      'Merged over auto-detection so a seller can correct mis-detected columns.',
  })
  @IsOptional()
  @IsObject()
  mappingOverride?: Record<string, string>;
}
