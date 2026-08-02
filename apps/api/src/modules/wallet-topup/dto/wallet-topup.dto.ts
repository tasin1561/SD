import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Currency, TopupRequestStatus } from '@skydrop/db';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
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

  @ApiPropertyOptional({ description: 'IFSC, routing number or SWIFT' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  branchCode?: string;

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
}
