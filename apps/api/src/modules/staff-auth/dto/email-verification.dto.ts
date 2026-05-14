import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class StaffEmailVerificationConfirmDto {
  @ApiProperty({ description: 'Verification token from the email link' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;
}
