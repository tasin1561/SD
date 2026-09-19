import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ResellerMoneyParty, StoreDisputeKind, TicketStatus } from '@skydrop/db';
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

  /**
   * RS-7 (2026-09-19). Omitted ⇒ GENERAL, so every existing caller is
   * unchanged. FIGURE_CORRECTION additionally REQUIRES the claim below:
   * the money on the order is already paid or planned, and "the figures
   * are wrong" with no figure in it is not something staff can settle.
   */
  @ApiPropertyOptional({
    enum: StoreDisputeKind,
    default: StoreDisputeKind.GENERAL,
    description:
      'GENERAL (something went wrong with the goods or the order) or FIGURE_CORRECTION (the money worked out on this order is wrong). A correction must say what is owed and by whom.',
  })
  @IsOptional()
  @IsEnum(StoreDisputeKind)
  readonly disputeKind?: StoreDisputeKind;

  @ApiPropertyOptional({
    description:
      'FIGURE_CORRECTION only. What you say is owed — a decimal string, more than 0, up to 2dp. A CLAIM, not a settlement: Skydrop settles with its own figure.',
    example: '120.00',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'claimAmountInr must be a decimal string with up to 2 decimal places',
  })
  readonly claimAmountInr?: string;

  @ApiPropertyOptional({
    enum: ResellerMoneyParty,
    description: 'FIGURE_CORRECTION only. Who you say owes it: STORE or SELLER.',
  })
  @IsOptional()
  @IsEnum(ResellerMoneyParty)
  readonly claimPayer?: ResellerMoneyParty;
}

/**
 * RS-7 (2026-09-19) — SELLER STAFF raise a dispute with one of their own
 * reseller stores, about one of that store's orders.
 *
 * The same shape the store's own form takes plus nothing: the STORE is
 * read off the order, never named here, so a seller cannot file against a
 * store that had nothing to do with it.
 */
export class CreateSellerStoreDisputeDto extends CreateStoreDisputeDto {}

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
