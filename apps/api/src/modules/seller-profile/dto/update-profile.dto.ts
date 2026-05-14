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

export class UpdateSellerProfileDto {
  @ApiProperty({ required: false, example: 'Acme Trading Co.' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  companyName?: string;

  @ApiProperty({ required: false, example: 'Sara Khan' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactPersonName?: string;

  @ApiProperty({ required: false, example: '+8801712345678', description: 'E.164 format, must be BD (+880...)' })
  @IsOptional()
  @IsString()
  @Matches(E164_BD, { message: 'phone must be E.164 BD format (e.g., +8801712345678)' })
  phone?: string;

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
