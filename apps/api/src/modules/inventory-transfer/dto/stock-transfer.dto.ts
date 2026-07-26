import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateStockTransferDto {
  @ApiProperty()
  @IsUUID()
  readonly sellerId!: string;

  @ApiProperty()
  @IsUUID()
  readonly variantId!: string;

  @ApiProperty({ minimum: 1, description: 'Units to move (positive integer)' })
  @IsInt()
  @Min(1)
  readonly qty!: number;

  @ApiProperty()
  @IsUUID()
  readonly sourceWarehouseId!: string;

  @ApiProperty()
  @IsUUID()
  readonly sourceBinId!: string;

  @ApiProperty()
  @IsUUID()
  readonly sourceBatchId!: string;

  @ApiProperty()
  @IsUUID()
  readonly destWarehouseId!: string;

  @ApiProperty()
  @IsUUID()
  readonly destBinId!: string;

  @ApiProperty({
    description:
      'Destination batch. Required explicitly — batches are warehouse-scoped, and auto-creating one would lose expiry/unit-cost lineage that FEFO picking relies on.',
  })
  @IsUUID()
  readonly destBatchId!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  readonly reason?: string;
}
