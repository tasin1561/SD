import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { RecordReceiptLineDto } from './admin-goods-receipt.dto';

export type DiscrepancyResolutionMode = 'CORRECT' | 'FORCE_COMPLETE';

/**
 * CORRECT: admin supplies corrected actuals (the true physical count);
 *          the receipt completes writing stock for the corrected qtys.
 * FORCE_COMPLETE: accept the recorded discrepancy as-is; the receipt
 *          completes writing stock for the actual received qtys and a
 *          PERMANENT note records the accepted shortage.
 */
export class ResolveDiscrepancyDto {
  @ApiProperty({ enum: ['CORRECT', 'FORCE_COMPLETE'] })
  @IsIn(['CORRECT', 'FORCE_COMPLETE'])
  mode!: DiscrepancyResolutionMode;

  @ApiProperty({
    required: false,
    maxLength: 2000,
    description: 'Required for FORCE_COMPLETE; appended to discrepancyNotes',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiProperty({
    required: false,
    type: [RecordReceiptLineDto],
    description: 'Corrected line actuals (CORRECT mode)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecordReceiptLineDto)
  lines?: RecordReceiptLineDto[];
}
