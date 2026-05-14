import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, Max, MaxLength, Min } from 'class-validator';

export class CreateSellerInvitationDto {
  @ApiProperty({ example: 'newseller@brand.com', description: 'Invitee email (any case)' })
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 30,
    default: 7,
    description: 'Days until expiry',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}
