import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const E164 = /^\+[1-9]\d{6,14}$/;

/** Editable customer fields only. phoneE164 is immutable (ORD-7) and is
 *  intentionally absent. sellerId comes from auth, never the body. */
export class UpdateCustomerDto {
  @ApiProperty({ required: false, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiProperty({ required: false, example: '+919812345678' })
  @IsOptional()
  @IsString()
  @Matches(E164, { message: 'altPhoneE164 must be E.164' })
  altPhoneE164?: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  riskNotes?: string;

  @ApiProperty({ required: false, enum: ['en', 'hi'] })
  @IsOptional()
  @IsString()
  @Matches(/^(en|hi)$/, { message: 'preferredLanguage must be "en" or "hi"' })
  preferredLanguage?: string;
}

export class ListCustomersQueryDto {
  @ApiProperty({ required: false, description: 'Matches phone / name / email.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

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
}

export class RecipientAddressQueryDto {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiProperty({ required: false, description: 'Matches line1 / city / postal code.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiProperty({ required: false, default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
