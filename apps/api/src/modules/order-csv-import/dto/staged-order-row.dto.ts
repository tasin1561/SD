import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ArrayMinSize,
  MaxLength,
} from 'class-validator';
import {
  BULK_FIX_FIELDS,
  SELECTION_FIELDS,
  type BulkFixField,
  type SelectionField,
} from '../services/staged-order-bulk-fix.service';

export class ListStagedRowsQueryDto {
  @ApiPropertyOptional({ description: 'Narrow to one upload' })
  @IsOptional()
  @IsUUID('7')
  uploadId?: string;
}

export class PatchStagedRowDto {
  @ApiProperty({
    description:
      'The fields to set, merged over what the file supplied. The whole row is re-validated afterwards.',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  data!: Record<string, unknown>;
}

export class BulkFixApplyDto {
  @ApiProperty({ enum: BULK_FIX_FIELDS })
  @IsIn([...BULK_FIX_FIELDS])
  field!: BulkFixField;

  @ApiProperty({ description: 'The value the rows carry now ("" for a missing landmark)' })
  @IsString()
  @MaxLength(500)
  fromValue!: string;

  @ApiProperty({ description: 'The value to set' })
  @IsString()
  @MaxLength(500)
  toValue!: string;

  @ApiPropertyOptional({ description: 'Narrow to these rows; omit for every matching pending row' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('7', { each: true })
  rowIds?: string[];

  @ApiPropertyOptional({ description: 'Import rows that become clean, via "Import as order"' })
  @IsOptional()
  @IsBoolean()
  importAfterFix?: boolean;
}

/** At most this many staged rows per bulk click. */
export const PENDING_BULK_MAX = 500;

export class PendingBulkIdsDto {
  @ApiProperty({ type: [String], description: `1 to ${PENDING_BULK_MAX} staged-row ids.` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PENDING_BULK_MAX)
  @IsUUID('7', { each: true })
  rowIds!: string[];

  @ApiProperty({
    description: 'A fresh random value per click; a repeat returns the first result.',
  })
  @IsString()
  @Length(8, 100)
  idempotencyKey!: string;
}

export class PendingBulkSetFieldDto extends PendingBulkIdsDto {
  @ApiProperty({ enum: SELECTION_FIELDS })
  @IsIn([...SELECTION_FIELDS])
  field!: SelectionField;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  value!: string;
}
