import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class OnboardingStepOverrideDto {
  @ApiProperty({
    required: false,
    minLength: 2,
    maxLength: 1000,
    description: 'Why an admin manually marked this step complete (recorded in audit log)',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  reason?: string;
}
