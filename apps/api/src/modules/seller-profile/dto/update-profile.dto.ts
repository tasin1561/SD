import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const E164_BD = /^\+880\d{9,12}$/;

/**
 * What a seller may change about themselves.
 *
 * `companyName` and `phone` are deliberately ABSENT.
 *
 * They are the identity the account was approved on: an admin read that
 * company name and that number and said yes to them. Letting the seller
 * rewrite either after approval means the approved entity quietly
 * becomes a different one, with nothing in the record marking the
 * moment — and the phone is how the call centre reaches the person
 * answering for those orders.
 *
 * Removing them from the DTO rather than disabling the inputs is the
 * point: `forbidNonWhitelisted` now REJECTS a request carrying either,
 * so the rule holds against anything that talks to the API, not just
 * against the form (FE-2 — the server is the boundary, the UI is
 * cosmetic).
 *
 * A genuine correction is a support request, not a self-service edit.
 * There is no admin endpoint for it today either, which is a real gap
 * worth closing separately — the answer to "we approved a typo" should
 * be a staff action with an audit row, not a field anyone can retype.
 */
export class UpdateSellerProfileDto {
  @ApiProperty({ required: false, example: 'Sara Khan' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactPersonName?: string;

  // Optional + nullable: `null` clears the whatsapp number, undefined leaves it unchanged.
  @ApiProperty({ required: false, nullable: true, example: '+8801712345678' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(E164_BD, { message: 'whatsapp must be E.164 BD format (e.g., +8801712345678)' })
  whatsapp?: string | null;

  @ApiProperty({ required: false, enum: ['en', 'bn'] })
  @IsOptional()
  @IsIn(['en', 'bn'])
  displayLanguage?: 'en' | 'bn';

  @ApiProperty({ required: false, enum: ['INR', 'BDT'] })
  @IsOptional()
  @IsIn(['INR', 'BDT'])
  displayCurrency?: 'INR' | 'BDT';
}
