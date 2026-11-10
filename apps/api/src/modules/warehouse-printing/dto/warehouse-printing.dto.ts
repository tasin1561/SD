import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PickBatchStatus } from '@skydrop/db';

export class ShipmentSelectionDto {
  @ApiProperty({ type: [String], description: 'Shipments to act on, in the order selected' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('7', { each: true })
  shipmentIds!: string[];
}

export class ReprintLabelsDto {
  @ApiProperty({ type: [String], description: 'Parcels whose label is being reprinted' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @IsUUID('7', { each: true })
  shipmentIds!: string[];

  @ApiProperty({ description: 'Why — a torn label, a printer jam, a lost stack' })
  @IsString()
  @MinLength(10)
  reason!: string;
}

export class PickBatchQueryDto {
  @ApiPropertyOptional({ description: 'Batch number, order number or AWB' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;

  @ApiPropertyOptional({ enum: PickBatchStatus })
  @IsOptional()
  @IsEnum(PickBatchStatus)
  status?: PickBatchStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ProductLocationQueryDto {
  @ApiProperty({ description: 'Product name, SKU or barcode' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  q!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class QueueQueryDto {
  @ApiPropertyOptional({ description: 'Restrict to one warehouse' })
  @IsOptional()
  @IsUUID('7')
  warehouseId?: string;
}

export class SkuLabelItemDto {
  @ApiProperty()
  @IsUUID('7')
  variantId!: string;

  /** One sticker per unit. Capped so a typo cannot ask for 10,000. */
  @ApiProperty({ minimum: 1, maximum: 500 })
  @IsInt()
  @Min(1)
  @Max(500)
  quantity!: number;
}

export class SkuLabelRequestDto {
  @ApiProperty({ type: [SkuLabelItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SkuLabelItemDto)
  items!: SkuLabelItemDto[];
}

/**
 * Releasing a PRINTED pick batch nobody will walk.
 *
 * The reason is required because the sheet still exists somewhere: the
 * next person to find it has to be able to learn that it is dead.
 */
export class ReleasePickBatchDto {
  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

/**
 * A short pick: the sheet said N, the shelf held fewer. The expected
 * count is NOT accepted — the server reads it from the line.
 */
export class RecordShortPickDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('7')
  shipmentItemId!: string;

  @ApiProperty({ minimum: 0, maximum: 100000, description: 'How many were actually on the shelf' })
  @IsInt()
  @Min(0)
  @Max(100000)
  qtyFound!: number;
}
