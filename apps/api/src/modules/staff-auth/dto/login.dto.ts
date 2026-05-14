import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class StaffLoginDto {
  @ApiProperty({ example: 'admin@skydrop.online', description: 'Email — case-insensitive' })
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: '************', description: 'Plaintext password' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}
