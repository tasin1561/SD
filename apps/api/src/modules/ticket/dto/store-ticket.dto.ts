import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ResellerMoneyParty, TicketStatus } from '@skydrop/db';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * RS-7 — a reseller store raises a dispute with its seller about ONE OF
 * ITS OWN orders. The store is the caller's token's, never a field here.
 */
export class CreateStoreDisputeDto {
  @ApiProperty({ description: 'The store’s own order this dispute is about.' })
  @IsUUID()
  readonly orderId!: string;

  @ApiProperty({ maxLength: 200, example: 'Seller sent the wrong colour' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  readonly subject!: string;

  @ApiPropertyOptional({
    maxLength: 4000,
    description: 'What happened, in the store’s words. The seller and Skydrop both read it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  readonly description?: string;
}

/** The store's own disputes, a page at a time. */
export class StoreTicketListQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'REVIEWING', 'CLOSED'] })
  @IsOptional()
  @IsIn(['OPEN', 'REVIEWING', 'CLOSED'])
  readonly stage?: 'OPEN' | 'REVIEWING' | 'CLOSED';

  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  readonly status?: TicketStatus;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly pageSize?: number;
}

/**
 * RS-7 — staff settle a store ↔ seller dispute: money moves BETWEEN the
 * store's and the seller's wallets, never from ours.
 */
export class SettleStoreDisputeDto {
  @ApiProperty({
    description: 'Decimal string, more than 0, up to 2 decimal places.',
    example: '450.00',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amountInr must be a decimal string with up to 2 decimal places',
  })
  readonly amountInr!: string;

  @ApiProperty({
    enum: ResellerMoneyParty,
    description: 'Who pays the other: STORE pays the seller, or SELLER pays the store.',
  })
  @IsEnum(ResellerMoneyParty)
  readonly payer!: ResellerMoneyParty;

  @ApiPropertyOptional({
    maxLength: 2000,
    description: 'Our note on the settlement. The seller reads it; so does the store.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  readonly notes?: string;
}
