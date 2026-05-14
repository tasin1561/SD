import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class SellerLoginDto {
  @ApiProperty({ example: 'seller@brand.com', description: 'Email — case-insensitive' })
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ description: 'Plaintext password' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}
