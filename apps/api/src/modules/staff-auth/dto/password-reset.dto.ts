import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class StaffPasswordResetRequestDto {
  @ApiProperty({ example: 'admin@skydrop.online' })
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(254)
  email!: string;
}

export class StaffPasswordResetConfirmDto {
  @ApiProperty({ description: 'Reset token from the email link' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;

  @ApiProperty({ minLength: 12, description: 'New password — minimum 12 characters' })
  @IsString()
  @MinLength(12, { message: 'newPassword must be at least 12 characters' })
  @MaxLength(256)
  newPassword!: string;
}
