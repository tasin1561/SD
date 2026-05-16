import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { StockMovementType } from '@skydrop/db';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/** Seller-scoped movement ledger query (sellerId comes from the JWT). */
export class ListSellerMovementsQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('7')
  variantId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('7')
  warehouseId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('7')
  batchId?: string;

  @ApiProperty({ required: false, enum: StockMovementType })
  @IsOptional()
  @IsEnum(StockMovementType)
  type?: StockMovementType;

  @ApiProperty({ required: false, description: 'Inclusive lower bound on createdAt (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiProperty({ required: false, description: 'Inclusive upper bound on createdAt (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** Admin movement ledger query — cross-seller, more filter dimensions. */
export class ListAdminMovementsQueryDto extends ListSellerMovementsQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('7')
  sellerId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('7')
  binId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('7')
  orderId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('7')
  adjustmentId?: string;
}
