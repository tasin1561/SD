import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsISO8601,
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

/** Rupees as a string — never a float on a money path. */
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const AMOUNT_MESSAGE = 'Give the amount in rupees, with at most two decimals (e.g. 1250.50).';

/** The seller moves money from their wallet into a store they manage. */
export class SellerStoreTopUpDto {
  @ApiProperty({ example: '5000.00' })
  @IsString()
  @Matches(AMOUNT, { message: AMOUNT_MESSAGE })
  amountInr!: string;

  @ApiPropertyOptional({ description: 'What the store reads under the line.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'IDEM-1 — generated when the form opens.' })
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}

/** The seller records paying a store they manage, off-platform. */
export class SellerStorePayoutDto {
  @ApiProperty({ example: '2000.00' })
  @IsString()
  @Matches(AMOUNT, { message: AMOUNT_MESSAGE })
  amountInr!: string;

  @ApiProperty({ description: 'How it was paid — the store reads this.' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  note!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}

export class SetStoreNegativeLimitDto {
  @ApiProperty({ example: '5000.00', description: 'How far below zero the store may go.' })
  @IsString()
  @Matches(AMOUNT, { message: AMOUNT_MESSAGE })
  negativeLimitInr!: string;
}

export class StoreTopupProofPresignDto {
  @ApiProperty({ example: 'image/png' })
  @IsString()
  @MaxLength(80)
  mimeType!: string;
}

export class SubmitStoreTopupDto {
  @ApiProperty()
  @IsUUID()
  bankAccountId!: string;

  @ApiProperty({ example: '10000.00' })
  @IsString()
  @Matches(AMOUNT, { message: AMOUNT_MESSAGE })
  amountInr!: string;

  @ApiPropertyOptional({ description: 'The bank reference / UTR.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  transactionRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  proofSpacesKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  proofMimeType?: string;
}

export class RequestStoreWithdrawalDto {
  @ApiProperty({ example: '3000.00' })
  @IsString()
  @Matches(AMOUNT, { message: AMOUNT_MESSAGE })
  amountInr!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(160)
  payeeName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(40)
  payeeAccountNumber!: string;

  @ApiProperty({ example: 'HDFC0001234' })
  @IsString()
  @MaxLength(20)
  payeeIfsc!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  payeeBankName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class StoreTopupAcceptDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class StoreWalletRejectDto {
  @ApiProperty({ description: 'Why — the store reads it.' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class PayStoreWithdrawalDto {
  @ApiProperty()
  @IsUUID()
  paidFromAccountId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  bankReference!: string;

  @ApiProperty({ example: '2026-09-14T10:00:00.000Z' })
  @IsISO8601()
  paidAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}

export class StoreWalletLedgerQueryDto {
  @ApiPropertyOptional({ description: 'An entry id — the page older than it.' })
  @IsOptional()
  @IsUUID()
  before?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
