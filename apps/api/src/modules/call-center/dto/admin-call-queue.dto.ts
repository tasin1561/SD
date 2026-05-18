import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CallQueueStatus } from '@skydrop/db';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ListCallQueueQueryDto {
  @ApiProperty({ required: false, enum: CallQueueStatus })
  @IsOptional()
  @IsEnum(CallQueueStatus)
  status?: CallQueueStatus;

  @ApiProperty({ required: false, description: 'Filter by the order’s seller' })
  @IsOptional()
  @IsUUID('7')
  sellerId?: string;

  @ApiProperty({ required: false, description: 'Filter by assigned agent' })
  @IsOptional()
  @IsUUID('7')
  agentId?: string;

  @ApiProperty({ required: false, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ReassignDto {
  @ApiProperty({ description: 'StaffUser id to reassign the entry to' })
  @IsUUID('7')
  toAgentId!: string;
}

export class BulkDequeueDto {
  @ApiProperty({ description: 'Close every OPEN queue entry for this seller' })
  @IsUUID('7')
  sellerId!: string;

  @ApiProperty({ minLength: 2, maxLength: 500 })
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;
}
