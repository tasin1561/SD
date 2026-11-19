import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { BULK_MAX_ORDERS } from './bulk-result';

/** The body of every bulk action that takes a hand-picked selection. */
export class BulkOrderIdsDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: BULK_MAX_ORDERS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX_ORDERS)
  @IsUUID('7', { each: true })
  orderIds!: string[];
}
