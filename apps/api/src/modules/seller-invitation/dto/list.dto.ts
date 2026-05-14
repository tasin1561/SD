import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export type InvitationListStatus = 'pending' | 'used' | 'expired' | 'deleted';

export class ListSellerInvitationsQueryDto {
  @ApiProperty({
    required: false,
    enum: ['pending', 'used', 'expired', 'deleted'],
    description: 'Filter by lifecycle status (derived from usedAt / expiresAt / deletedAt)',
  })
  @IsOptional()
  @IsIn(['pending', 'used', 'expired', 'deleted'])
  status?: InvitationListStatus;

  @ApiProperty({ required: false, description: 'Substring match on email (case-insensitive)' })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;

  @ApiProperty({ required: false, type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdAfter?: string;

  @ApiProperty({ required: false, type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdBefore?: string;

  @ApiProperty({ required: false, default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({ required: false, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class InvitationListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: ['pending', 'used', 'expired', 'deleted'] })
  status!: InvitationListStatus;

  @ApiProperty()
  invitedById!: string;

  @ApiProperty({ nullable: true })
  sellerId!: string | null;

  @ApiProperty()
  expiresAt!: Date;

  @ApiProperty({ nullable: true })
  usedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

export class InvitationListResponseDto {
  @ApiProperty({ type: () => [InvitationListItemDto] })
  items!: InvitationListItemDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;
}

/** Returned only on create — the plaintext is shown ONCE so the admin can
 *  copy it into their channel of choice. After that we only return the
 *  hashed-row metadata. */
export class CreatedInvitationDto extends InvitationListItemDto {
  @ApiProperty({ description: 'Plaintext invitation token — shown only once' })
  token!: string;

  @ApiProperty({ description: 'Pre-formatted accept URL containing the plaintext token' })
  inviteUrl!: string;
}
