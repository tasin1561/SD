import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class BackfillShortfallTicketsDto {
  @ApiProperty({
    required: false,
    default: true,
    description:
      'Default TRUE: report what would be opened and sent, with the exact words, and write ' +
      'nothing. Pass false to open the tickets and send the surplus notices.',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
