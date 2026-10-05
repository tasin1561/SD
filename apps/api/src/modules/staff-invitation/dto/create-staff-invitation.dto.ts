import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * ── WHY ROLE IDS AND NOT THE `StaffRole` ENUM ───────────────────────
 * This DTO validated `@IsEnum(StaffRole)`, so **nobody could be invited
 * onto a role the team invented** — the only route onto a custom role
 * was to invite somebody as one of the seven seeded ones and change it
 * afterwards. That made the roles screen half a feature: an operator
 * could build exactly the role a new colleague needed and then had to
 * hand them a different one to get them in the door.
 *
 * Plural because a person may hold several (a job function and an
 * access tier), and an invitation has to be able to say the same thing
 * the assignment does — otherwise the first thing to happen after
 * somebody joins is a correction.
 */
export class CreateStaffInvitationDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: '`staff_roles.id`s — at least one. Custom roles are as valid as seeded ones.',
  })
  @IsArray()
  @ArrayMinSize(1)
  // A cap so a malformed client cannot ask for a thousand lookups. Far
  // above any real team's role count.
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  roleIds!: string[];

  @ApiProperty({ required: false, minimum: 1, maximum: 30, default: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}

/** The roles somebody holds, replaced wholesale. */
export class SetStaffRolesDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  roleIds!: string[];
}

/**
 * TRANSITIONAL single-role body, for the deploy window in which the
 * admin app still sends one role. Goes with the `/role` route.
 */
export class SetStaffRoleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  roleId!: string;
}
