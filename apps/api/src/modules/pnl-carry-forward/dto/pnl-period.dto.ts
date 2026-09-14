import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * Thin on purpose: whether a reason is long enough, whether a confirmation
 * matches, and whether a month may be locked, are the SERVICE's to refuse
 * (FE-2 — the page shows the verdict verbatim). The DTO checks only the shape.
 */
export class ClosePnlMonthDto {
  @ApiProperty({ description: 'Why this month is being closed by hand (at least 10 characters)' })
  @IsString()
  @Length(1, 1000)
  reason!: string;
}

export class LockPermanentlyDto {
  @ApiProperty({
    description: 'Why this provisional month is being locked permanently (at least 10 characters)',
  })
  @IsString()
  @Length(1, 1000)
  reason!: string;
}

export class GodModeRelockDto {
  @ApiProperty({ description: 'Why this locked month must be restated (at least 30 characters)' })
  @IsString()
  @Length(1, 2000)
  reason!: string;

  @ApiProperty({ description: 'The month typed out again, exactly (YYYY-MM)', example: '2026-08' })
  @IsString()
  @Length(0, 20)
  confirmMonth!: string;

  @ApiProperty({ description: 'Must be literally true' })
  @IsBoolean()
  acknowledgeRisk!: boolean;
}

export class BackfillPnlCloseDto {
  @ApiPropertyOptional({
    description: 'True (the default): say what would be closed and write nothing.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description: 'The last month to close, YYYY-MM. Defaults to last month.',
    example: '2026-08',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  throughMonth?: string;

  @ApiPropertyOptional({
    description: 'Why — required (at least 10 characters) when not a dry run',
  })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  reason?: string;
}
