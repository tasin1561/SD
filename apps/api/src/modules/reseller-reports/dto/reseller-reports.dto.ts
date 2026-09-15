import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { StoreExpenseCategory } from '@skydrop/db';

/** A report window `[from, to)`: ISO instants, parsed by `reportWindow`. */
export class ReportWindowQueryDto {
  @ApiPropertyOptional({ description: 'Start (inclusive), ISO instant — an IST midnight.' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({
    description: 'End (exclusive), ISO instant — the IST midnight after the last day.',
  })
  @IsOptional()
  @IsString()
  to?: string;
}

export class RecordStoreExpenseDto {
  @ApiProperty({ enum: StoreExpenseCategory })
  @IsEnum(StoreExpenseCategory)
  category!: StoreExpenseCategory;

  @ApiProperty({ example: '1250.00' })
  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,2})?$/, {
    message: 'Give the amount in rupees, with at most two decimals (e.g. 1250.50).',
  })
  amountInr!: string;

  @ApiProperty({ example: '2026-09-14', description: 'The Indian calendar day it was spent.' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Give the date as YYYY-MM-DD.' })
  expenseDate!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ description: 'An invoice or receipt number.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional({ description: 'IDEM-1 — generated when the form opens.' })
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}

export class RemoveStoreExpenseDto {
  @ApiProperty({ description: 'Why — it stays on the record.' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class AutoPauseRuleDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ example: '35', description: 'Pause when MORE than this % of parcels came back.' })
  @IsString()
  @Matches(/^\d{1,3}(\.\d{1,2})?$/, { message: 'Give a percentage, e.g. 35 or 35.5.' })
  returnRatePercent!: string;

  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  minDecidedOrders!: number;

  @ApiProperty({ example: 30 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  windowDays!: number;
}

export class AdminPauseStoreDto {
  @ApiProperty({ description: 'Why — the seller and the store read it.' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
