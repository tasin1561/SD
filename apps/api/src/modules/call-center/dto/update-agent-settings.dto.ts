import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * PATCH body for agent call settings. Every field optional (PATCH —
 * omitted keys are untouched). The agent-editable vs admin-only split
 * (locked decision 10c) is enforced in AgentSettingsService, NOT here:
 * a non-admin supplying `maxActiveCalls` / `canHandleHighRisk` /
 * `canHandleHighValue` is rejected 403 FIELD_ADMIN_ONLY.
 */
export class UpdateAgentSettingsDto {
  // ── agent-editable ──────────────────────────────────────────────────
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiProperty({ required: false, example: '09:00', description: 'HH:MM 24h' })
  @IsOptional()
  @IsString()
  @Matches(HHMM, { message: 'workingHoursStart must be HH:MM (24h)' })
  workingHoursStart?: string;

  @ApiProperty({ required: false, example: '18:00', description: 'HH:MM 24h' })
  @IsOptional()
  @IsString()
  @Matches(HHMM, { message: 'workingHoursEnd must be HH:MM (24h)' })
  workingHoursEnd?: string;

  @ApiProperty({
    required: false,
    type: [Number],
    description: 'ISO weekday numbers 0–6 (advisory only — not enforced, 10b)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays?: number[];

  @ApiProperty({ required: false, example: 'Asia/Kolkata' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiProperty({ required: false, type: [String], example: ['en', 'hi'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(16, { each: true })
  languages?: string[];

  // ── admin-only (rejected for self-edit by the service) ──────────────
  @ApiProperty({
    required: false,
    minimum: 1,
    description: 'Concurrent-assignment cap (10a). Admin-only.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxActiveCalls?: number;

  @ApiProperty({ required: false, description: 'Admin-only.' })
  @IsOptional()
  @IsBoolean()
  canHandleHighRisk?: boolean;

  @ApiProperty({ required: false, description: 'Admin-only.' })
  @IsOptional()
  @IsBoolean()
  canHandleHighValue?: boolean;
}
