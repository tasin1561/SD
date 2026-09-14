import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel } from '@skydrop/db';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';

/** The in-app topic (NOTIF-17 — named in the seller topic catalogue). */
export const RESELLER_SET_ASIDE_SHRUNK_TOPIC = 'seller.reseller_set_aside_shrunk';
/** Who at the seller is told: the people who set reseller stock. */
export const STORES_PRICING_PERMISSION = 'stores.pricing';

export interface SetAsideShrunkNotice {
  readonly sellerId: string;
  readonly skuCode: string;
  readonly onHand: number;
  readonly steps: ReadonlyArray<{
    readonly shrinkId: string;
    readonly storeName: string;
    readonly fromQty: number;
    readonly toQty: number;
  }>;
}

/**
 * RS-3 — tells a seller that the hourly sweep cut a reseller set-aside
 * because stock fell below what had been promised to their stores.
 *
 * In-app only, to the people holding `stores.pricing`, OPERATIONAL (so a
 * person may silence it, NOTIF-17). One notice per (seller, variant) per
 * sweep, its event id taken from the first shrink row, so a retried job
 * is refused by the NOTIF-2 partial unique rather than telling twice.
 *
 * AWAITED by the sweep after its transaction commits and NEVER throws:
 * the shrink is the durable fact (its rows are written in the same
 * transaction), the notice a reflection of it (NOTIF-1). Awaited, not
 * fire-and-forget, so no write outlives the job for the e2e reset to
 * drain (NOTIF-19).
 */
@Injectable()
export class ResellerSetAsideNotifier {
  private readonly logger = new Logger(ResellerSetAsideNotifier.name);

  constructor(private readonly dispatch: NotificationDispatchService) {}

  async setAsideShrunk(notice: SetAsideShrunkNotice): Promise<void> {
    const first = notice.steps[0];
    if (first === undefined) return;
    const lines = notice.steps.map((s) => `“${s.storeName}”: ${s.fromQty} → ${s.toQty}`).join('; ');
    try {
      await this.dispatch.dispatch({
        topic: RESELLER_SET_ASIDE_SHRUNK_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: `Stock set aside for your reseller stores was reduced (${notice.skuCode})`,
        body:
          `Only ${notice.onHand} of ${notice.skuCode} are on hand now, fewer than you had set ` +
          `aside for your reseller stores, so we reduced the newest set-asides first: ${lines}. ` +
          'Nothing else changed — review the stores’ stock settings if you want a different split.',
        channels: [NotificationChannel.IN_APP],
        audience: [
          {
            kind: 'SELLER_PERMISSION',
            sellerId: notice.sellerId,
            permission: STORES_PRICING_PERMISSION,
          },
        ],
        triggerEvent: 'reseller_set_aside.shrunk',
        eventId: `reseller_set_aside_shrunk:${first.shrinkId}:inapp`,
      });
    } catch (err) {
      this.logger.warn(
        { sellerId: notice.sellerId, err: err instanceof Error ? err.message : String(err) },
        'Reseller set-aside shrink notice failed; the shrink itself stands',
      );
    }
  }
}
