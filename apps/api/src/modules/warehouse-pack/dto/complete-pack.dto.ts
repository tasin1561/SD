import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

export class ForceCompletePackDto extends CompletePackDto {
  /**
   * Why this parcel is going out without its contents being scanned.
   *
   * Long enough to be a sentence, because the audit row is the only
   * record that anybody chose this — and "ok" tells whoever reads it
   * back nothing about whether it should have happened.
   */
  @ApiProperty({ minLength: 20, maxLength: 500 })
  @IsString()
  @MinLength(20)
  @MaxLength(500)
  readonly reason!: string;
}
