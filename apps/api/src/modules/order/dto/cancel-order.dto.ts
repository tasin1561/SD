import { ApiProperty } from '@nestjs/swagger';
import { OrderCancellationReason } from '@skydrop/db';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Seller/customer-initiated cancel. Lands the order in CANCELLED with a
 * reason (admin sane-cancel uses CANCELLED_BY_ADMIN — a separate path).
 * Only valid from pre-reservation states (DRAFT / PENDING_CONFIRMATION);
 * a CONFIRMED+ order needs the stock-releasing OrderWriteService path.
 */
export class CancelOrderDto {
  @ApiProperty({
    required: false,
    enum: OrderCancellationReason,
    default: OrderCancellationReason.SELLER_REQUESTED,
  })
  @IsOptional()
  @IsEnum(OrderCancellationReason)
  reason?: OrderCancellationReason;

  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
