import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const E164 = /^\+[1-9]\d{6,14}$/;

export class SellerRegisterViaInvitationDto {
  @ApiProperty({ description: 'Invitation token from the email link' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;

  @ApiProperty({ example: 'Acme Trading Co.' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  companyName!: string;

  @ApiProperty({ example: 'Sara Khan' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactPersonName!: string;

  @ApiProperty({ example: '+8801712345678', description: 'E.164 format' })
  @IsString()
  @Matches(E164, { message: 'phone must be E.164 (e.g., +8801712345678)' })
  phone!: string;

  @ApiProperty({
    required: false,
    example: '+8801712345678',
    description: 'E.164 format, optional',
  })
  @IsOptional()
  @IsString()
  @Matches(E164, { message: 'whatsapp must be E.164 (e.g., +8801712345678)' })
  whatsapp?: string;

  @ApiProperty({ minLength: 10, description: 'Initial password — minimum 10 characters' })
  @IsString()
  @MinLength(10, { message: 'password must be at least 10 characters' })
  @MaxLength(256)
  password!: string;

  @ApiProperty({ required: false, enum: ['en', 'bn'], default: 'en' })
  @IsOptional()
  @IsIn(['en', 'bn'])
  displayLanguage?: 'en' | 'bn';

  @ApiProperty({ required: false, enum: ['INR', 'BDT'], default: 'INR' })
  @IsOptional()
  @IsIn(['INR', 'BDT'])
  displayCurrency?: 'INR' | 'BDT';
}
