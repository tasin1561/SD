import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * A replay drives the same order transitions a real scan would, so it
 * carries a reason for the same purpose `ResolveIssueDto.note` does:
 * the row it writes to `audit_logs` has to explain itself to whoever
 * reads it next, long after the screen is gone.
 */
export class ReplayWebhookDto {
  @ApiProperty({
    description: 'Why this webhook is being handed back to the processor.',
    minLength: 5,
    maxLength: 2000,
    example: 'Parser bug fixed in 76ff486d; applying the scan this job dropped on 13 Sep.',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  reason!: string;
}
