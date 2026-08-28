import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  COURIER_SUPPORT_ADAPTERS,
  type CourierSupportAdapter,
} from '../../courier-shared/services/courier-support-adapter';

/**
 * Which courier's support desk an escalation belongs to.
 *
 * ── WHY THIS IS NOT "INJECT THE ADAPTER" ─────────────────────────────
 * The dispatcher and reconciler each held ONE adapter, which was right
 * while there was one courier and is a live hazard with two: a
 * Shiprocket escalation would be answered by Delhivery's adapter, and
 * because that adapter's read capabilities are gated on Delhivery's MCP
 * being provisioned, the day that flips on the reconciler starts asking
 * Delhivery about Shiprocket tickets. It would not throw — it would
 * return nothing, and the item would sit in SENT_UNCONFIRMED, which is
 * the one state that needs a read-back to leave.
 */
@Injectable()
export class CourierSupportRegistryService {
  private readonly logger = new Logger(CourierSupportRegistryService.name);

  constructor(
    @Inject(COURIER_SUPPORT_ADAPTERS)
    private readonly adapters: readonly CourierSupportAdapter[],
  ) {}

  /**
   * The adapter for this courier.
   *
   * An unknown courier gets NULL rather than a default, and the caller
   * routes the item to a human. Defaulting to whichever adapter happens
   * to be first is how a message intended for one company is filed with
   * another.
   */
  for(courierCode: string): CourierSupportAdapter | null {
    const found = this.adapters.find((a) => a.courierCode === courierCode);
    if (found === undefined) {
      this.logger.warn(
        { courierCode, known: this.adapters.map((a) => a.courierCode) },
        'No support adapter for this courier — the item goes to a human',
      );
      return null;
    }
    return found;
  }

  /** Every courier we could talk to, for the ops console. */
  known(): readonly string[] {
    return this.adapters.map((a) => a.courierCode);
  }
}
