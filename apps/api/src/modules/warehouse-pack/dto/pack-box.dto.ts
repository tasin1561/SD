import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Every field here is "what the scanner read". Kept as a plain string
 * and trimmed in the service rather than transformed at the boundary:
 * the raw code is recorded verbatim on the scan row, because when a
 * packer swears they scanned the right thing, the thing they actually
 * scanned is the evidence.
 */

export class OpenPackBoxDto {
  @ApiProperty({
    description: 'The AWB from the shipping label on the box.',
    example: 'DLVSTUB202608000042',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  awbNumber!: string;
}

export class ScanIntoPackBoxDto {
  @ApiProperty({
    description:
      'A product code — either a per-unit serial (serialized products) or the SKU barcode.',
    example: 'SKU-BLUE-KURTA-M',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  code!: string;
}

export class ClosePackBoxDto {
  @ApiProperty({
    description:
      'The label scanned again. Must match the one the box was opened with — that is how a swapped box is caught.',
    example: 'DLVSTUB202608000042',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  awbNumber!: string;
}

export class CancelPackBoxDto {
  @ApiProperty({
    description: 'Why the box was abandoned. Recorded as operational evidence.',
    example: 'Customer cancelled while packing',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
