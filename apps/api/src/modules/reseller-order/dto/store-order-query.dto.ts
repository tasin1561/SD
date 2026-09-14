import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { OrderStatus } from '@skydrop/db';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** A reseller store's order list. The store is the caller's; never a parameter. */
export class StoreOrderListQueryDto {
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

  @ApiProperty({ required: false, enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiProperty({
    required: false,
    maxLength: 120,
    description: 'Order number, your reference, customer name or phone, or waybill.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

/** Create a store API key. The plaintext is returned once, in the response. */
export class CreateStoreApiKeyDto {
  @ApiProperty({ maxLength: 80, example: 'Shopify connector' })
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 730 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  expiresInDays?: number;
}
