import { Injectable } from '@nestjs/common';
import {
  CourierWriteGuardService,
  type CourierWriteOperation,
} from '../../courier-shared/services/courier-write-guard.service';

/**
 * The Delhivery half of the courier write guard.
 *
 * ── WHY THIS IS A WRAPPER AND NOT THE IMPLEMENTATION ─────────────────
 * It was the implementation, and stayed that way while Delhivery was
 * the only integration. Adding Shiprocket made the choice concrete:
 * either copy 190 lines and let the two drift, or keep one guard and
 * pass it a courier code. The generic one lives in `courier-shared`
 * (the R3 rule — a primitive both couriers need belongs to neither).
 *
 * This class survives because nine call sites read well as
 * `this.writeGuard.assertWritable('ndr.action', ...)` and none of them
 * should have to name Delhivery in a Delhivery service. The setting keys
 * are unchanged — `courier.delhivery_live_writes_enabled` and
 * `courier.delhivery_api_base_url` — because the generic guard derives
 * them from the code, so nothing about the deployed configuration moves.
 */
export type DelhiveryWriteOperation = CourierWriteOperation;

export const DELHIVERY_COURIER_CODE = 'delhivery';

@Injectable()
export class DelhiveryWriteGuardService {
  constructor(private readonly guard: CourierWriteGuardService) {}

  /** Whether the write flag is on. Says nothing about WHERE writes go. */
  async liveWritesEnabled(): Promise<boolean> {
    return this.guard.liveWritesEnabled(DELHIVERY_COURIER_CODE);
  }

  /** Where writes would currently go: a simulator, or Delhivery itself. */
  async writeTarget(): Promise<{ simulator: boolean; host: string }> {
    return this.guard.writeTarget(DELHIVERY_COURIER_CODE);
  }

  /** Assert a physical-world write is permitted, or throw 403. */
  async assertWritable(
    operation: DelhiveryWriteOperation,
    context: Record<string, unknown> = {},
  ): Promise<void> {
    return this.guard.assertWritable(DELHIVERY_COURIER_CODE, operation, context);
  }
}
