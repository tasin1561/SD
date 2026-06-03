import { ApiProperty } from '@nestjs/swagger';
import { StaffRole } from '@skydrop/db';
import { IsEmail, IsEnum, IsInt, IsOptional, Max, MaxLength, Min } from 'class-validator';

export class CreateStaffInvitationDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ enum: StaffRole })
  @IsEnum(StaffRole)
  role!: StaffRole;

  @ApiProperty({ required: false, minimum: 1, maximum: 30, default: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}
