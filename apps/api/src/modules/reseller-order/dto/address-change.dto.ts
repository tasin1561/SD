import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { UpdateOrderDto } from '../../order/dto/update-order.dto';

/**
 * A store correcting its own consignee (2026-09-16).
 *
 * It EXTENDS the seller's `UpdateOrderDto` — one shape for one order —
 * and adds the one thing a held correction needs that an immediate one
 * does not: why.
 *
 * ── `reason` MUST BE STRIPPED BEFORE THE PATCH REACHES `edit` ─────────
 * `OrderService.edit` refuses every key outside `STORE_EDITABLE_KEYS` BY
 * NAME (`STORE_EDIT_RECIPIENT_ONLY`) rather than ignoring it — which is
 * the right behaviour and exactly why this field cannot be passed
 * through. `StoreOrderEditService` destructures it off. If a future
 * field is added here, it has to be destructured off too.
 */
export class StoreEditRecipientDto extends UpdateOrderDto {
  @ApiPropertyOptional({
    description:
      'Why the details are wrong, in the store’s words. REQUIRED when the seller has set address ' +
      'corrections to “ask me first” — they read this before deciding, and a correction with no ' +
      'account of where it came from is unanswerable.',
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
