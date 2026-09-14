import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** RS-2 — the reseller store portal's auth DTOs. Same limits as the seller's. */

export class StoreLoginDto {
  @ApiProperty({ example: 'owner@mystore.in', description: 'Email — case-insensitive' })
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ description: 'Plaintext password' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class StorePasswordResetRequestDto {
  @ApiProperty({ example: 'owner@mystore.in' })
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(254)
  email!: string;
}

export class StorePasswordResetConfirmDto {
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

export class StoreTokenDto {
  @ApiProperty({ description: 'Token from the email link' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;
}

export class StoreAcceptInvitationDto {
  @ApiProperty({ description: 'Invitation token from the email link' })
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  token!: string;

  @ApiProperty({ minLength: 10, maxLength: 256 })
  @IsString()
  @MinLength(10, { message: 'password must be at least 10 characters' })
  @MaxLength(256)
  password!: string;

  @ApiProperty({ description: 'Your name, as your team will see it' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName!: string;
}
