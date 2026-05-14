import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class SellerPasswordResetRequestDto {
  @ApiProperty({ example: 'seller@brand.com' })
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(254)
  email!: string;
}

export class SellerPasswordResetConfirmDto {
  @ApiProperty({ description: 'Reset token from the email link' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;

  @ApiProperty({ minLength: 10, description: 'New password — minimum 10 characters' })
  @IsString()
  @MinLength(10, { message: 'newPassword must be at least 10 characters' })
  @MaxLength(256)
  newPassword!: string;
}
