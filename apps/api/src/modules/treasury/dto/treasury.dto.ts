import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BankEntryType, BankOwnerKind, Currency } from '@skydrop/db';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
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
  @ApiPropertyOptional({ description: 'The rate the seller was shown' })
  @IsOptional()
  @IsNumberString()
  quotedRate?: string;
  @IsDateString() movedAt!: string;
  @IsOptional() @IsString() @Length(1, 200) reference?: string;
  @IsOptional() @IsString() @Length(1, 2000) note?: string;
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
}
