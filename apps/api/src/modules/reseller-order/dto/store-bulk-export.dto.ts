import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import { BULK_MAX_EXPORT } from '../../../common/bulk/bulk-result';
import { StoreOrderListQueryDto } from './store-order-query.dto';

/** `{ orderIds }` or `{ filter }` (the store list's own query) — exactly one. */
export class StoreBulkExportDto {
  @ApiPropertyOptional({ type: [String], maxItems: BULK_MAX_EXPORT })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX_EXPORT)
  @IsUUID('7', { each: true })
  orderIds?: string[];

  @ApiPropertyOptional({ type: StoreOrderListQueryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => StoreOrderListQueryDto)
  filter?: StoreOrderListQueryDto;
}
