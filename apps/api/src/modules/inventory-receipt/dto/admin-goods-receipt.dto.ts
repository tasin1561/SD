import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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
  IsString,
  IsUUID,
  Max,
  MaxLength,
  MinLength,
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

  /**
   * Several statuses at once, as CSV (`PENDING,ARRIVING`) or a repeated
   * param. Kept server-side so `total` and the pager stay honest. When both
   * `status` and `statuses` are sent, the receipt must satisfy both.
   */
  @ApiProperty({ required: false, enum: GoodsReceiptStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    const parts = Array.isArray(value) ? value : typeof value === 'string' ? [value] : value;
    return Array.isArray(parts)
      ? parts
          .flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
          .map((v) => (typeof v === 'string' ? v.trim() : v))
      : parts;
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(GoodsReceiptStatus, { each: true })
  statuses?: GoodsReceiptStatus[];

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

  @ApiProperty({
    required: false,
    description:
      'Putaway bin. Required when this warehouse tracks locations; ignored entirely when it does not.',
  })
  @IsOptional()
  @IsUUID('7')
  putawayBinId?: string;

  @ApiProperty({
    required: false,
    maxLength: 64,
    description:
      'Optional free note of where the goods were physically put, recorded while the warehouse is NOT tracking locations. A head start when tracking is switched on — never an authority, since stock sells and moves afterwards.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  notedLocation?: string;

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

export class CancelGoodsReceiptDto {
  @ApiProperty({
    minLength: 10,
    maxLength: 500,
    description: 'Why this receipt is being cancelled. Recorded permanently on the receipt.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

export class AmendReceiptCountDto {
  @ApiProperty({ minimum: 0, description: 'The corrected count of good units received' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  receivedQty!: number;

  @ApiProperty({
    required: false,
    minimum: 0,
    description: 'The corrected damaged count. Omit to leave the damaged count as it is.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  damagedQty?: number;

  @ApiProperty({
    minLength: 10,
    maxLength: 500,
    description: 'Why the recorded count is being overridden. Audited and put on the leg’s ticket.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
