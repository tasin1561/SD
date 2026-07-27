import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { GoodsReceiptStatus } from '@skydrop/db';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ListAdminGoodsReceiptsQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('7')
  sellerId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('7')
  warehouseId?: string;

  @ApiProperty({ required: false, enum: GoodsReceiptStatus })
  @IsOptional()
  @IsEnum(GoodsReceiptStatus)
  status?: GoodsReceiptStatus;

  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class RecordReceiptLineDto {
  @ApiProperty({ description: 'The goods_receipt_lines.id being counted' })
  @IsUUID('7')
  lineId!: string;

  @ApiProperty({ minimum: 0, description: 'Good units actually received' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  receivedQty!: number;

  @ApiProperty({
    required: false,
    minimum: 0,
    default: 0,
    description: 'Units arrived damaged (not stocked in 1A)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  damagedQty?: number;

  @ApiProperty({ required: false, description: 'Putaway bin (required when receivedQty > 0)' })
  @IsOptional()
  @IsUUID('7')
  putawayBinId?: string;

  @ApiProperty({
    required: false,
    description: 'Override declared manufacture date from physical goods',
  })
  @IsOptional()
  @IsDateString()
  manufacturedAt?: string;

  @ApiProperty({ required: false, description: 'Override declared expiry from physical goods' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCostInr?: number;
}

export class RecordReceiptLinesDto {
  @ApiProperty({ type: [RecordReceiptLineDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecordReceiptLineDto)
  lines!: RecordReceiptLineDto[];
}

/**
 * R4 — optional supplier serials captured at receiving, keyed by
 * goods-receipt-line id. Only consulted for STRICT-mode SKUs; any line
 * omitted (or short) gets Skydrop-generated serials to print, so intake
 * is never blocked by a supplier that doesn't serialize.
 */
export class CompleteGoodsReceiptDto {
  @ApiPropertyOptional({
    description: 'Map of goodsReceiptLineId -> scanned unit serials. Strict-mode lines only.',
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  @IsOptional()
  @IsObject()
  readonly serialsByLineId?: Record<string, string[]>;
}
