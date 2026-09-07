import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { OrderSource, OrderStatus } from '@skydrop/db';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class ListOrdersQueryDto {
  @ApiProperty({ required: false, enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiProperty({ required: false, enum: OrderSource })
  @IsOptional()
  @IsEnum(OrderSource)
  source?: OrderSource;

  @ApiProperty({
    required: false,
    description:
      'Matches orderNumber / sellerOrderRef / recipient name / phone / AWB waybill number.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'Narrow to one shopfront' })
  @IsOptional()
  @IsUUID('7')
  storeId?: string;

  @ApiProperty({ required: false, description: 'ISO instant — orders placed at or after this.' })
  @IsOptional()
  @IsISO8601()
  placedFrom?: string;

  @ApiProperty({ required: false, description: 'ISO instant — orders placed at or before this.' })
  @IsOptional()
  @IsISO8601()
  placedTo?: string;

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
