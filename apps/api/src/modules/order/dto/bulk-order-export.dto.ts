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
import { AdminListOrdersQueryDto } from './admin-order.dto';
import { ListOrdersQueryDto } from './list-orders-query.dto';

/**
 * `{ orderIds }` for a hand-picked set, or `{ filter }` — the SAME query
 * the list endpoint takes — for "all N matching". Exactly one of the two;
 * the service refuses both and neither.
 */
export class SellerBulkExportDto {
  @ApiPropertyOptional({ type: [String], maxItems: BULK_MAX_EXPORT })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX_EXPORT)
  @IsUUID('7', { each: true })
  orderIds?: string[];

  @ApiPropertyOptional({ type: ListOrdersQueryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ListOrdersQueryDto)
  filter?: ListOrdersQueryDto;
}

export class AdminBulkExportDto {
  @ApiPropertyOptional({ type: [String], maxItems: BULK_MAX_EXPORT })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX_EXPORT)
  @IsUUID('7', { each: true })
  orderIds?: string[];

  @ApiPropertyOptional({ type: AdminListOrdersQueryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AdminListOrdersQueryDto)
  filter?: AdminListOrdersQueryDto;
}
