import { ApiProperty } from '@nestjs/swagger';
import { AddressType } from '@skydrop/db';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const ALLOWED_TYPES = [
  AddressType.BD_ORIGIN,
  AddressType.BD_OFFICE,
  AddressType.IN_RETURN,
] as const;

export type SellerOwnedAddressType = (typeof ALLOWED_TYPES)[number];

export class CreateSellerAddressDto {
  @ApiProperty({ enum: ALLOWED_TYPES, description: 'BD_ORIGIN | BD_OFFICE | IN_RETURN' })
  @IsEnum(AddressType)
  type!: SellerOwnedAddressType;

  @ApiProperty({ required: false, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;

  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactName!: string;

  // Phone country-match is enforced in the service (depends on `type`).
  @ApiProperty({ example: '+8801712345678 (BD types) or +919876543210 (IN types)' })
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  contactPhone!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;

  @ApiProperty({ minLength: 2, maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  line1!: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  landmark?: string;

  @ApiProperty({ minLength: 1, maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  city!: string;

  @ApiProperty({ minLength: 1, maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  stateProvince!: string;

  // Postal-code format is enforced in the service (BD=4 digits, IN=6 digits).
  @ApiProperty({ description: 'BD: 4 digits, IN: 6 digits' })
  @IsString()
  @MinLength(4)
  @MaxLength(10)
  postalCode!: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
