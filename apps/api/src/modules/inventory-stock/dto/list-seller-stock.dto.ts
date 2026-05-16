import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { VariantStatus } from '@skydrop/db';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListSellerStockQueryDto {
  @ApiProperty({ required: false, description: 'Filter by catalog category' })
  @IsOptional()
  @IsUUID('7')
  categoryId?: string;

  @ApiProperty({ required: false, enum: VariantStatus, description: 'Filter by variant status' })
  @IsOptional()
  @IsEnum(VariantStatus)
  status?: VariantStatus;

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
