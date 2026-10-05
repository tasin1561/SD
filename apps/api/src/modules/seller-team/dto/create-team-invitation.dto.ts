import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * ── WHY ROLE IDS AND NOT THE `SellerUserRole` ENUM ──────────────────
 * This validated `@IsEnum(SellerUserRole)`, so a company could build
 * exactly the role a new colleague needed on the roles screen and then
 * had no way to invite anybody onto it — the only route was to invite
 * them as one of the six defaults and change it afterwards.
 *
 * Plural because a person may hold several, and an invitation has to be
 * able to say the same thing the assignment does.
 */
export class CreateTeamInvitationDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: '`seller_roles.id`s belonging to THIS company — at least one.',
  })
  @IsArray()
  @ArrayMinSize(1)
  // A cap so a malformed client cannot ask for a thousand lookups.
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  roleIds!: string[];

  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 30, default: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}

/** The roles a team member holds, replaced wholesale. */
export class SetTeamMemberRolesDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  roleIds!: string[];
}

/**
 * TRANSITIONAL single-role body, for the deploy window in which the
 * seller app still sends one role. Goes with the `/role` route.
 */
export class SetTeamMemberRoleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  roleId!: string;
}
