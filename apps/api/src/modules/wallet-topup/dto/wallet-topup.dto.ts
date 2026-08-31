import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Currency, TopupRequestStatus } from '@skydrop/db';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PresignTopupProofDto {
  @ApiProperty({ description: 'image/jpeg, image/png, image/webp or application/pdf' })
  @IsString()
  mimeType!: string;
}

export class SubmitTopupDto {
  @ApiProperty({ description: 'Which of our accounts you sent the money to' })
  @IsUUID('7')
  bankAccountId!: string;

  @ApiProperty({ minimum: 0.01 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({
    description:
      'Your bank reference / UTR. Either this or a proof upload is required — without one there is nothing to match against our statement.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  transactionRef?: string;

  @ApiPropertyOptional({ description: 'Spaces key returned by the presign call' })
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

export class ReviewTopupDto {
  @ApiPropertyOptional({ description: 'Optional note recorded against the decision' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectTopupDto {
  @ApiProperty({ minLength: 5, description: 'The seller sees this — say what was wrong' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class ListTopupsQueryDto {
  @ApiPropertyOptional({ enum: TopupRequestStatus })
  @IsOptional()
  @IsEnum(TopupRequestStatus)
  status?: TopupRequestStatus;
}

export class UpsertPlatformBankAccountDto {
  @ApiProperty({ description: 'Short name sellers pick from, e.g. "HDFC — current"' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  label!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  bankName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(160)
  accountName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  accountNumber!: string;

  @ApiPropertyOptional({ description: 'IFSC (India) or SWIFT — NOT the BEFTN routing number' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  branchCode?: string;

  @ApiPropertyOptional({ description: 'Branch the account is held at' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  branchName?: string;

  @ApiPropertyOptional({ description: 'District the branch is in' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @ApiPropertyOptional({
    description:
      'BEFTN routing number (Bangladesh), 9 digits. Text, not a number — a leading zero is ' +
      'significant and an integer would eat it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  routingNumber?: string;

  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  currency!: Currency;

  @ApiPropertyOptional({ description: 'Anything the seller needs to put in the transfer' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({
    description:
      'What the account is FOR, in your own words — the estate changes shape faster than an ' +
      'enum can be migrated.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  purpose?: string;

  @ApiPropertyOptional({
    description:
      'The courier account whose payouts land here. `CourierSettlementService.record` resolves ' +
      'the receiving account through THIS field (TRE-3), so a settlement for a courier with no ' +
      'linked account is refused — the money would be a number with no cash behind it.',
  })
  @IsOptional()
  @IsUUID('7')
  courierAccountId?: string;

  @ApiPropertyOptional({
    description:
      'What is in the account right now, in its own currency. Posted as an OPENING_BALANCE ' +
      'entry against OUR money in the same transaction as the account itself — an account ' +
      'created without one starts at zero and every figure derived from it reads as zero. ' +
      'Ignored on update: a balance is corrected by reconciling against a statement, never ' +
      'by editing a field, because the ledger is the history of what we believed and when.',
  })
  @IsOptional()
  @IsNumberString()
  openingBalance?: string;
}
