import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CallQueueStatus } from '@skydrop/db';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * `OPEN` is not a CallQueueStatus — it is "waiting or assigned, not yet
 * resolved", the two statuses together.
 *
 * It exists because the page's own subtitle is "what is waiting to be
 * confirmed, and who is holding it", and a COMPLETED row is neither. An
 * order that has been retried shows one row per attempt cycle (locked
 * decision #2), so listing every status by default put the history
 * beside the live entry and made a working retry look like a duplicate.
 */
export const CALL_QUEUE_VIEW_OPEN = 'OPEN' as const;

export class ListCallQueueQueryDto {
  @ApiProperty({
    required: false,
    enum: [...Object.values(CallQueueStatus), CALL_QUEUE_VIEW_OPEN],
    description:
      'A single status, or OPEN for pending+assigned together. Omitted returns every status, history included.',
  })
  @IsOptional()
  @IsIn([...Object.values(CallQueueStatus), CALL_QUEUE_VIEW_OPEN])
  status?: CallQueueStatus | typeof CALL_QUEUE_VIEW_OPEN;

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
