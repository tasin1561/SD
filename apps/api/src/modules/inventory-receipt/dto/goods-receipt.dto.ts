import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { GoodsReceiptStatus } from '@skydrop/db';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class DeclareReceiptLineDto {
  @ApiProperty()
  @IsUUID('7')
  variantId!: string;

  @ApiProperty({ minimum: 1, description: 'Units the seller expects to ship' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  expectedQty!: number;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCostInr?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  manufacturedAt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class DeclareGoodsReceiptDto {
  @ApiProperty({ required: false, description: 'Defaults to the configured default warehouse' })
  @IsOptional()
  @IsUUID('7')
  warehouseId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expectedArrivalAt?: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sellerReference?: string;

  @ApiProperty({ type: [DeclareReceiptLineDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DeclareReceiptLineDto)
  lines!: DeclareReceiptLineDto[];
}

/** PENDING-only edit. Omitting `lines` leaves them unchanged; providing it
 *  replaces the full set. */
export class UpdateGoodsReceiptDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expectedArrivalAt?: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sellerReference?: string;

  @ApiProperty({ required: false, type: [DeclareReceiptLineDto], minItems: 1 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DeclareReceiptLineDto)
  lines?: DeclareReceiptLineDto[];
}

export class ListGoodsReceiptsQueryDto {
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
