import { ApiProperty } from '@nestjs/swagger';
import { OrderCancellationReason } from '@skydrop/db';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ListOrdersQueryDto } from './list-orders-query.dto';

export class AdminListOrdersQueryDto extends ListOrdersQueryDto {
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'Cross-seller by default; narrow to one seller when set.',
  })
  @IsOptional()
  @IsUUID('7')
  sellerId?: string;
}

/**
 * SANE admin cancel — drives the order to CANCELLED_BY_ADMIN through the
 * state machine (OrderWriteService.transitionStatus). This is NOT god
 * mode (ORD-2 forceMutate, hasAdminOverride) — that bypass path is out
 * of Checkpoint 2 scope. Reserved orders release stock via the saga.
 */
export class AdminCancelOrderDto {
  @ApiProperty({
    required: false,
    enum: OrderCancellationReason,
    default: OrderCancellationReason.OTHER,
  })
  @IsOptional()
  @IsEnum(OrderCancellationReason)
  cancellationReason?: OrderCancellationReason;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
