import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ProductStatus } from '@skydrop/db';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListProductsQueryDto {
  @ApiProperty({ required: false, enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('7')
  categoryId?: string;

  @ApiProperty({ required: false, description: 'Substring match on name / externalRef / brand' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

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
