import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Which kind of account a session is opened inside. */
export const IMPERSONATION_SUBJECT_KINDS = ['SELLER', 'STORE'] as const;
export type ImpersonationSubjectKind = (typeof IMPERSONATION_SUBJECT_KINDS)[number];

/**
 * The shortest reason we are willing to call a reason.
 *
 * Twenty characters is not a magic number; it is roughly the length of
 * the shortest sentence that names a thing and a purpose — "payout
 * mismatch on #4471". "checking", "support" and "." all fall under it,
 * and those are the entries that make a review worthless: the reviewer
 * is left with the fact that somebody was inside an account and no way
 * to judge whether they should have been. A support session with no
 * stated reason is UNREVIEWABLE, and an unreviewable session is
 * indistinguishable from an abuse of one, so the floor is enforced here
 * rather than asked for in the UI.
 */
export const MIN_IMPERSONATION_REASON_LENGTH = 20;

export class StartImpersonationDto {
  @ApiProperty({
    enum: IMPERSONATION_SUBJECT_KINDS,
    description: 'A seller account, or a reseller store that logs in on its own.',
  })
  @IsIn(IMPERSONATION_SUBJECT_KINDS)
  subjectKind!: ImpersonationSubjectKind;

  @ApiProperty({ description: '`sellers.id` or `seller_stores.id`, matching subjectKind.' })
  @IsUUID('7')
  subjectId!: string;

  @ApiProperty({
    minLength: MIN_IMPERSONATION_REASON_LENGTH,
    description:
      'Why you are going in, in a sentence. Shown in full on every review of this session and written into the audit row, which is the only account anybody will ever have of it.',
  })
  @IsString()
  // Trimmed BEFORE the length check so twenty spaces is not a reason.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(MIN_IMPERSONATION_REASON_LENGTH)
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Ask to be able to CHANGE things, not just look. Needs `support.impersonate.write` on top of `support.impersonate`, and a long list of routes stays refused either way.',
  })
  @IsOptional()
  @IsBoolean()
  mayWrite?: boolean;
}

export class VerifyImpersonationDto {
  @ApiProperty({ description: 'The six-digit code emailed to YOU, not to the account holder.' })
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class EndImpersonationDto {
  @ApiPropertyOptional({
    description:
      'Optional note for the review — "done" is fine when you are closing your own session, and worth filling in when you are closing somebody else\'s.',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(500)
  reason?: string;
}

export class ListImpersonationQueryDto {
  @ApiPropertyOptional({ description: 'Only sessions opened by this staff member.' })
  @IsOptional()
  @IsUUID('7')
  staffUserId?: string;

  @ApiPropertyOptional({ description: 'Only sessions opened inside this seller account.' })
  @IsOptional()
  @IsUUID('7')
  sellerId?: string;

  @ApiPropertyOptional({ description: 'Only sessions opened inside this reseller store.' })
  @IsOptional()
  @IsUUID('7')
  storeId?: string;

  @ApiPropertyOptional({
    default: 50,
    description: 'Newest first. Capped, because this is a review screen and not an export.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
