import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class RecordPickItemDto {
  @ApiProperty({ description: 'UUID v7 of the target shipment_item row' })
  @IsUUID('7')
  readonly shipmentItemId!: string;

  @ApiProperty({ description: 'UUID v7 of the warehouse_bin the picker pulled from' })
  @IsUUID('7')
  readonly pickedBinId!: string;

  @ApiProperty({ description: 'UUID v7 of the stock_batch the picker pulled from' })
  @IsUUID('7')
  readonly pickedBatchId!: string;

  @ApiPropertyOptional({
    description:
      'R4 — the unit serials scanned off the shelf. REQUIRED for a strict-mode SKU (exactly `quantity` of them); ignored for a normal-mode one.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  readonly scannedSerials?: string[];
}
