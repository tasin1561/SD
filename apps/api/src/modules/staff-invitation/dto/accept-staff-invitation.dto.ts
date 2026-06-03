import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AcceptStaffInvitationDto {
  @ApiProperty({ description: 'Plaintext token from the email link' })
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  token!: string;

  @ApiProperty({ minLength: 12, maxLength: 256 })
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  password!: string;
}
