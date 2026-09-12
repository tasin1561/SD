import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BankEntryType, BankOwnerKind, Currency } from '@skydrop/db';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class RecordTransferDto {
  @IsUUID('7') fromAccountId!: string;
  @IsUUID('7') toAccountId!: string;
  @ApiProperty({ description: 'What left the sending account, in ITS currency' })
  @IsNumberString()
  amountOut!: string;
  @ApiProperty({ description: 'What arrived, in the receiving account currency' })
  @IsNumberString()
  amountIn!: string;
  @ApiPropertyOptional({ description: 'Whose money moved. Omit for our own.' })
  @IsOptional()
  @IsUUID('7')
  sellerId?: string;
  @ApiPropertyOptional({
    description:
      'The rate the seller was shown, for their money moving INTO another currency. Refused ' +
      '(TRANSFER_QUOTE_INTO_WALLET_CURRENCY) when the money arrives in rupees: they are ' +
      'credited its book value and the gap is our FX.',
  })
  @IsOptional()
  @IsNumberString()
  quotedRate?: string;
  @IsDateString() movedAt!: string;
  @IsOptional() @IsString() @Length(1, 200) reference?: string;
  @IsOptional() @IsString() @Length(1, 2000) note?: string;
  @ApiPropertyOptional({
    description:
      'One key per opening of the form. A retry with the same key returns the original ' +
      'transfer and moves nothing.',
  })
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}

export class RecordEntryDto {
  @IsUUID('7') accountId!: string;
  @IsEnum(BankEntryType) type!: BankEntryType;
  @ApiProperty({ description: 'Negative for money leaving' })
  @IsNumberString()
  signedAmount!: string;
  @ApiProperty({
    enum: Currency,
    description:
      'What currency the amount is in. Checked against the account rather than assumed, ' +
      'so a figure typed against the wrong account is refused instead of relabelled.',
  })
  @IsEnum(Currency)
  amountCurrency!: Currency;
  @IsEnum(BankOwnerKind) ownerKind!: BankOwnerKind;
  @IsOptional() @IsUUID('7') sellerId?: string;
  @IsOptional() @IsUUID('7') expenseCategoryId?: string;
  @IsOptional() @IsUUID('7') investmentId?: string;
  @IsDateString() occurredAt!: string;
  @IsOptional() @IsString() @Length(1, 200) reference?: string;
  @IsOptional() @IsString() @Length(1, 2000) note?: string;
}

export class ReconcileAccountDto {
  @IsEnum(BankOwnerKind) ownerKind!: BankOwnerKind;
  @IsOptional() @IsUUID('7') sellerId?: string;
  @ApiProperty({ description: 'What the bank statement actually says' })
  @IsNumberString()
  statedBalance!: string;
  @ApiProperty({ description: 'Why the book was wrong' })
  @IsString()
  @Length(10, 2000)
  reason!: string;
  @ApiPropertyOptional({
    description:
      "This is the account's OPENING balance — money the business already had, left off " +
      'the P&L. Our own money only, and once per account.',
  })
  @IsOptional()
  @IsBoolean()
  isOpeningBalance?: boolean;
}

export class OwnerMoneyDto {
  @ApiProperty({
    enum: ['IN', 'OUT'],
    description: 'IN: the owner put money into the business. OUT: the owner took money out.',
  })
  @IsIn(['IN', 'OUT'])
  direction!: 'IN' | 'OUT';
  @ApiProperty({ description: "How much, in the account's own currency (positive)" })
  @IsNumberString()
  amount!: string;
  @IsDateString() occurredAt!: string;
  @ApiProperty({ description: 'What it was for — kept with the entry' })
  @IsString()
  @Length(10, 2000)
  reason!: string;
  @IsOptional() @IsString() @Length(1, 200) reference?: string;
  @ApiPropertyOptional({
    description:
      'One key per opening of the form. A retry with the same key returns the original ' +
      'entry and posts nothing.',
  })
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}

export class ReclassifySellerCashDto {
  @ApiProperty({ description: 'The seller whose cash is being relabelled' })
  @IsUUID('7')
  sellerId!: string;
  @ApiProperty({
    enum: ['TO_CAPITAL', 'TO_SELLER'],
    description:
      "TO_CAPITAL: cash recorded as the seller's is really ours. TO_SELLER: the reverse.",
  })
  @IsIn(['TO_CAPITAL', 'TO_SELLER'])
  direction!: 'TO_CAPITAL' | 'TO_SELLER';
  @ApiProperty({ description: "How much, in the account's own currency (positive)" })
  @IsNumberString()
  amount!: string;
  @ApiProperty({ description: 'Why the attribution was wrong — kept with the entries' })
  @IsString()
  @Length(10, 2000)
  reason!: string;
}

export class CreateExpenseCategoryDto {
  @IsString() @Length(2, 60) @IsNotEmpty() code!: string;
  @IsString() @Length(2, 120) @IsNotEmpty() name!: string;
  @IsOptional() @IsString() @Length(1, 500) hint?: string;
}

export class UpdateExpenseCategoryDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() @Length(1, 500) hint?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateInvestmentDto {
  @IsString() @Length(2, 120) label!: string;
  @IsString() @Length(2, 200) counterparty!: string;
  @IsUUID('7') fromAccountId!: string;
  @ApiProperty({ description: 'Principal placed' })
  @IsNumberString()
  amount!: string;
  @IsDateString() placedAt!: string;
  @IsOptional() @IsString() @Length(1, 2000) note?: string;
  @ApiPropertyOptional({
    description:
      'The client’s key for this request, generated once when the form opens. A replay with the same key returns the original investment and places nothing.',
  })
  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;
}

export class RecordInvestmentReturnDto {
  @IsUUID('7') toAccountId!: string;
  @IsNumberString() amount!: string;
  @IsDateString() receivedAt!: string;
  @ApiPropertyOptional({ description: 'Close the investment with this return' })
  @IsOptional()
  @IsBoolean()
  close?: boolean;
  @IsOptional() @IsString() @Length(1, 2000) note?: string;
  @ApiPropertyOptional({
    description:
      'The client’s key for this request, generated once when the form opens. A replay with the same key returns the investment as it stands and records nothing.',
  })
  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;
}

export class RecordShipmentCostDto {
  @ApiPropertyOptional({ description: 'What the courier charged to deliver it' })
  @IsOptional()
  @IsNumberString()
  forwardCostInr?: string;
  @ApiPropertyOptional({
    description:
      'What they charged to bring it BACK. Separate from the forward cost — the delivery deduction is refunded on a return, so this is the whole cost of it.',
  })
  @IsOptional()
  @IsNumberString()
  rtoCostInr?: string;
}
