import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CycleCountStatus, CycleCountType } from '@skydrop/db';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ScheduleCycleCountDto {
  @ApiProperty({ required: false, description: 'Defaults to the configured default warehouse' })
  @IsOptional()
  @IsUUID('7')
  warehouseId?: string;

  @ApiProperty({ required: false, description: 'Scope the count to a single zone' })
  @IsOptional()
  @IsUUID('7')
  zoneId?: string;

  @ApiProperty({ enum: CycleCountType })
  @IsEnum(CycleCountType)
  countType!: CycleCountType;

  @ApiProperty({ description: 'Date the physical count is planned for (ISO 8601)' })
  @IsDateString()
  countDate!: string;
}

export class RecordCountItemDto {
  @ApiProperty()
  @IsUUID('7')
  variantId!: string;

  @ApiProperty()
  @IsUUID('7')
  binId!: string;

  @ApiProperty({ description: 'Concrete batch counted (required — systemQty is per bin+batch)' })
  @IsUUID('7')
  batchId!: string;

  @ApiProperty({ minimum: 0, description: 'Physically counted quantity' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  countedQty!: number;

  @ApiProperty({ required: false, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RecordCountItemsDto {
  @ApiProperty({ type: [RecordCountItemDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecordCountItemDto)
  items!: RecordCountItemDto[];
}

export class ListCycleCountsQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID('7')
  warehouseId?: string;

  @ApiProperty({ required: false, enum: CycleCountStatus })
  @IsOptional()
  @IsEnum(CycleCountStatus)
  status?: CycleCountStatus;

  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 20, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
