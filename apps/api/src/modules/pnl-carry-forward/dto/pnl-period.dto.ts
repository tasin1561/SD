import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * Thin on purpose: whether a reason is long enough, and whether a month
 * may be closed, are the SERVICE's to refuse (FE-2 — the page shows the
 * verdict verbatim). The DTO checks only the shape.
 */
export class ClosePnlMonthDto {
  @ApiProperty({ description: 'Why this month is being closed by hand (at least 10 characters)' })
  @IsString()
  @Length(1, 1000)
  reason!: string;
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
