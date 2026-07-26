import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

export class CompletePackDto {
  @ApiPropertyOptional({
    description:
      'R4 — every unit serial in the box, re-scanned at the pack bench. REQUIRED when the parcel carries strict-mode units (the scanned set must match the parcel exactly); ignored for an all-normal parcel.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  readonly scannedSerials?: string[];
}
