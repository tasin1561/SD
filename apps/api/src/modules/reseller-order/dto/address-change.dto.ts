import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { UpdateOrderDto } from '../../order/dto/update-order.dto';

/**
 * A store changing its own order (2026-09-16; widened beyond the
 * consignee 2026-09-18).
 *
 * It EXTENDS the seller's `UpdateOrderDto` — one shape for one order —
 * and adds the one thing a held change needs that an immediate one does
 * not: why.
 *
 * ── `reason` MUST BE STRIPPED BEFORE THE PATCH REACHES `edit` ─────────
 * `OrderService.edit` does not know the key, and the API's
 * `forbidNonWhitelisted` would reject the whole call. `StoreOrderEditService`
 * destructures it off. If a future field is added here, it has to be
 * destructured off too.
 */
export class StoreEditRecipientDto extends UpdateOrderDto {
  @ApiPropertyOptional({
    description:
      'Why the change is needed, in the store’s words. REQUIRED when the seller has set changes to ' +
      'this store’s orders to “ask me first” — they read this before deciding, and a change with ' +
      'no account of where it came from is unanswerable.',
  })
  @IsOptional()
  @IsString()
  @Length(10, 2000)
  readonly reason?: string;
}

export class DecideAddressChangeDto {
  @ApiPropertyOptional({
    description: 'Why. Required on a rejection — the store has a customer waiting on the answer.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  readonly note?: string;
}
