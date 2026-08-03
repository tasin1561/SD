import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InviteLeadStatus } from '@skydrop/db';
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SubmitInviteLeadDto {
  @ApiProperty({ example: 'Rahim Uddin' })
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @ApiProperty({ example: 'Dhaka Threads' })
  @IsString()
  @Length(2, 160)
  companyName!: string;

  @ApiProperty({ example: 'rahim@dhakathreads.com' })
  @IsEmail()
  @Length(5, 200)
  email!: string;

  @ApiProperty({
    example: '+8801712345678',
    description:
      'Kept as typed. A lead is never rejected over a phone format — the cost of losing a real prospect to a validation rule is far higher than the cost of an operator retyping a number.',
  })
  @IsString()
  @Length(6, 32)
  phone!: string;

  @ApiPropertyOptional({ example: 'Womenswear, mostly kurtis and sarees' })
  @IsOptional()
  @IsString()
  @Length(0, 300)
  productTypes?: string;

  @ApiPropertyOptional({ example: '200-500 a month' })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  monthlyOrders?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  message?: string;

  /**
   * A field no human sees, so a human never fills it.
   *
   * Most form spam is a script that fills every input it finds. This one
   * is hidden with CSS and left out of the tab order; anything arriving
   * with it set is answered with the same success response as a real
   * submission, because telling a bot it was caught is how it learns to
   * stop tripping the trap.
   */
  @ApiPropertyOptional({ description: 'Honeypot. Leave empty.' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  website?: string;
}

export class ListInviteLeadsQueryDto {
  @ApiPropertyOptional({ enum: InviteLeadStatus })
  @IsOptional()
  @IsEnum(InviteLeadStatus)
  status?: InviteLeadStatus;

  @ApiPropertyOptional({ description: 'Company, name, email or phone' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class UpdateInviteLeadDto {
  @ApiPropertyOptional({ enum: InviteLeadStatus })
  @IsOptional()
  @IsEnum(InviteLeadStatus)
  status?: InviteLeadStatus;

  @ApiPropertyOptional({ description: 'Internal. Never shown to the lead.' })
  @IsOptional()
  @IsString()
  @Length(0, 4000)
  notes?: string;
}
