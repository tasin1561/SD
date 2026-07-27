import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { SellerStatus } from '@skydrop/db';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export type SellerListSort =
  | 'createdAt:desc'
  | 'createdAt:asc'
  | 'companyName:asc'
  | 'approvedAt:desc';

export class ListSellersQueryDto {
  @ApiProperty({
    required: false,
    isArray: true,
    enum: SellerStatus,
    description:
      'Filter by one or more SellerStatus values (repeat ?status=APPROVED&status=SUSPENDED)',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(SellerStatus, { each: true })
  @Type(() => String)
  status?: SellerStatus[];

  @ApiProperty({
    required: false,
    description: 'true → only sellers with onboarding complete; false → only incomplete',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onboardingComplete?: boolean;

  @ApiProperty({
    required: false,
    description: 'Case-insensitive substring match against email, companyName, contactPersonName',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiProperty({ required: false, type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdAtFrom?: string;

  @ApiProperty({ required: false, type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdAtTo?: string;

  @ApiProperty({ required: false, type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  approvedAtFrom?: string;

  @ApiProperty({ required: false, type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  approvedAtTo?: string;

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

  @ApiProperty({
    required: false,
    enum: ['createdAt:desc', 'createdAt:asc', 'companyName:asc', 'approvedAt:desc'],
    default: 'createdAt:desc',
  })
  @IsOptional()
  @IsIn(['createdAt:desc', 'createdAt:asc', 'companyName:asc', 'approvedAt:desc'])
  sort?: SellerListSort;
}
