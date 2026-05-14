import { ApiProperty } from '@nestjs/swagger';
import { SellerStatus } from '@skydrop/db';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateSellerStatusDto {
  @ApiProperty({
    enum: [SellerStatus.SUSPENDED, SellerStatus.APPROVED],
    description: 'Target status. SUSPENDED requires reasonNote; APPROVED accepts optional note.',
  })
  @IsEnum(SellerStatus)
  newStatus!: SellerStatus;

  @ApiProperty({
    required: false,
    minLength: 2,
    maxLength: 2000,
    description: 'Required for SUSPENDED; optional for APPROVED (defaults to "Account reapproved")',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  reasonNote?: string;
}
