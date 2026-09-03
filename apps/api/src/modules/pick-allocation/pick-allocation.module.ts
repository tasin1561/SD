import { Module } from '@nestjs/common';

import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { PickAllocationService } from './pick-allocation.service';

/**
 * The WMS-3 retry wrapper, as a shared primitive (R3, eighth split).
 *
 * Two domains now allocate stock for a pick: the picker station and
 * print-first batching. Both need the SAME outer retry over M5's
 * `allocateAndPopulate` — the one that turns a rare terminal
 * PICK_ALLOCATION_CONFLICT into a non-terminal exhausted-retries result
 * a caller can fail-route on.
 *
 * It lived inside `warehouse-pick`, which is a LEAF that exports
 * nothing. Reaching into it would have broken that; copying the retry
 * into the second caller would have given the two of them separate
 * ideas about how many attempts is enough, which is precisely the drift
 * the R3 rule exists to prevent.
 *
 * Depends on nothing but the M5 surface, so it composes into either side
 * without a cycle and without `forwardRef`.
 */
@Module({
  imports: [InventoryStockModule],
  providers: [PickAllocationService],
  exports: [PickAllocationService],
})
export class PickAllocationModule {}
