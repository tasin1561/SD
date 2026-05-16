import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CategoryProposalStatus } from '@skydrop/db';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListCategoryProposalsQueryDto {
  @ApiProperty({ required: false, enum: CategoryProposalStatus })
  @IsOptional()
  @IsEnum(CategoryProposalStatus)
  status?: CategoryProposalStatus;

  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
