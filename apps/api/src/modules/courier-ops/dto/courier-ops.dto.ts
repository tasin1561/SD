import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const DOC_TYPES = [
  'EPOD',
  'SIGNATURE_URL',
  'RVP_QC_IMAGE',
  'SELLER_RETURN_IMAGE',
] as const;

export class ShipmentInsightQueryDto {
  @ApiPropertyOptional({
    enum: ['S', 'E', 'N'],
    description:
      'Transport mode for the TAT quote: S surface (default), E express, N none.',
  })
  @IsOptional()
  @IsIn(['S', 'E', 'N'])
  readonly mode?: 'S' | 'E' | 'N';
}

export class FetchDocumentQueryDto {
  @ApiProperty({
    enum: DOC_TYPES,
    description:
      'EPOD and SIGNATURE_URL settle a "never received it" dispute; the QC image covers a reverse pickup.',
  })
  @IsIn(DOC_TYPES)
  readonly docType!: (typeof DOC_TYPES)[number];
}

export class EditShipmentDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  readonly name?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  readonly phone?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly address?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  readonly productsDesc?: string;
}

export class CancelWithCourierDto {
  @ApiProperty({
    minLength: 10,
    description:
      'Why the parcel is being pulled. A parcel already moving becomes a RETURN rather than disappearing, so this is a costed decision worth explaining.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  readonly reason!: string;
}

export class AttachEwaybillDto {
  @ApiProperty({ description: 'Invoice the e-way bill was raised against.' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  readonly invoiceNumber!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  readonly ewaybillNumber!: string;
}

export class NdrActionDto {
  @ApiProperty({
    enum: ['RE-ATTEMPT', 'PICKUP_RESCHEDULE'],
    description:
      'RE-ATTEMPT asks for another delivery run; PICKUP_RESCHEDULE re-books a reverse pickup.',
  })
  @IsIn(['RE-ATTEMPT', 'PICKUP_RESCHEDULE'])
  readonly action!: 'RE-ATTEMPT' | 'PICKUP_RESCHEDULE';
}
