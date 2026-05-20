import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

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
}
