import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class BackfillAwbLabelsDto {
  @ApiPropertyOptional({
    description:
      'PRE_DISPATCH (default): parcels still in the building, where a missing label stops the pack bench. ALL: every live waybill, including parcels already with the courier.',
    enum: ['PRE_DISPATCH', 'ALL'],
  })
  @IsOptional()
  @IsIn(['PRE_DISPATCH', 'ALL'])
  scope?: 'PRE_DISPATCH' | 'ALL';

  @ApiPropertyOptional({
    description: 'How many shipments to take this run, oldest first. Default 25, at most 100.',
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Default TRUE: list what would be fetched and call nobody. Pass false to fetch and store.',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
