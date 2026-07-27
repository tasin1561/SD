import { ApiProperty } from '@nestjs/swagger';
import { CallOutcome } from '@skydrop/db';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Agent-logged call attempt (Phase 1A: manual logging — click-to-call /
 * Twilio deferred). `scheduledFor` is REQUIRED iff outcome ===
 * CALLBACK_REQUESTED and FORBIDDEN otherwise; the bound check (1h–7d)
 * and that invariant are enforced in CallAttemptService, not the DTO.
 * phoneE164 is intentionally NOT accepted — the attempt records the
 * immutable order recipient snapshot (ORD-6).
 */
export class RecordCallAttemptDto {
  @ApiProperty({ enum: CallOutcome })
  @IsEnum(CallOutcome)
  outcome!: CallOutcome;

  @ApiProperty({ description: 'ISO 8601 — when the call started' })
  @IsDateString()
  startedAt!: string;

  @ApiProperty({ required: false, description: 'ISO 8601 — when the call ended' })
  @IsOptional()
  @IsDateString()
  endedAt?: string;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  outcomeNotes?: string;

  @ApiProperty({ required: false, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerSaidName?: string;

  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerSaidAddress?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  customerVerifiedItems?: boolean;

  @ApiProperty({
    required: false,
    description: 'ISO 8601 callback time — required for CALLBACK_REQUESTED, rejected otherwise',
  })
  @IsOptional()
  @IsDateString()
  scheduledFor?: string;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rescheduledReason?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  flaggedAsSuspicious?: boolean;

  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  suspicionReason?: string;
}
