import { ApiProperty, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
import { CreateOrderDto } from './create-order.dto';

/** One line of a reseller store's order: what, how many, at what retail. */
export class CreateStoreOrderItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('7')
  variantId!: string;

  @ApiProperty({ minimum: 1, maximum: 100_000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity!: number;

  /**
   * What the store sells ONE unit for (INR).
   *
   * OPTIONAL since 2026-09-19 (owner, for the CSV column — but the rule
   * lives HERE so all three doors read the column the same way). Omitted,
   * the line takes the SUGGESTED RETAIL the seller set for this product
   * in this store's catalogue (RS-3); with no suggestion either it is
   * refused by name (`RESELLER_RETAIL_REQUIRED`) rather than defaulted to
   * zero, which would tell the customer the goods were free. It is NEVER
   * derived from the COD amount — that is a total over every line plus
   * delivery, less any advance.
   */
  @ApiProperty({
    required: false,
    minimum: 0,
    description:
      'What the store sells ONE unit for (INR). Must sit inside the retail range the seller set for this product, where one is set. Left out, the seller’s suggested retail for this store is used.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  retailUnitPriceInr?: number;
}

/**
 * RS-5 — an order a reseller store places (portal, CSV row or API key).
 *
 * The seller's `CreateOrderDto` minus what a store may not set: the store
 * (it is the caller's, from the token or key), Skydrop's internal notes,
 * and a bare `unitPriceInr` — a store states a RETAIL price per line,
 * checked against the seller's range and snapshotted with the transfer
 * price (RS-4). Everything else — the recipient block, payment, the
 * collectable's components — means what it means on a seller's order.
 */
export class CreateStoreOrderDto extends OmitType(CreateOrderDto, [
  'storeId',
  'items',
  'internalNotes',
  'sellerNotes',
] as const) {
  @ApiProperty({
    required: false,
    maxLength: 2000,
    description: 'Notes for the call centre and warehouse.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ type: [CreateStoreOrderItemDto], minItems: 1, maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateStoreOrderItemDto)
  items!: CreateStoreOrderItemDto[];
}
