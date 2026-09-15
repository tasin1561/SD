import { Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, NotificationChannel } from '@skydrop/db';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';

/** In-app topics (NOTIF-17 — named in the seller topic catalogue). */
export const RESELLER_STORE_AUTO_PAUSED_TOPIC = 'seller.reseller_store_auto_paused';
export const RESELLER_STOCK_REORDER_TOPIC = 'seller.reseller_stock_reorder';

/**
 * RS-9 — tells a seller what the reseller analysis did or found.
 *
 * In-app only, OPERATIONAL (so a person may silence either topic). Each
 * notice carries an event id built from what it is about, so a retried
 * sweep is refused by the NOTIF-2 partial unique rather than telling
 * twice. AWAITED by its sweep and NEVER throws: the pause is the durable
 * fact, the notice a reflection of it (NOTIF-1) — and, awaited rather
 * than fire-and-forget, no write outlives the job (NOTIF-19).
 */
@Injectable()
export class ResellerReportsNotifier {
  private readonly logger = new Logger(ResellerReportsNotifier.name);

  constructor(private readonly dispatch: NotificationDispatchService) {}

  async storeAutoPaused(notice: {
    readonly sellerId: string;
    readonly storeName: string;
    readonly returned: number;
    readonly decided: number;
    readonly returnRatePct: string;
    readonly limitPct: string;
    readonly windowDays: number;
    /** What makes this pause THIS pause (the store and the moment). */
    readonly eventKey: string;
  }): Promise<void> {
    try {
      await this.dispatch.dispatch({
        topic: RESELLER_STORE_AUTO_PAUSED_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: `Reseller store “${notice.storeName}” was paused for too many returns`,
        body:
          `${notice.returned} of ${notice.decided} of its parcels with a known outcome in the last ` +
          `${notice.windowDays} days came back (${notice.returnRatePct}%), over the ${notice.limitPct}% ` +
          'limit you set. It cannot place new orders until you resume it; orders already placed carry on.',
        channels: [NotificationChannel.IN_APP],
        audience: [
          { kind: 'SELLER_PERMISSION', sellerId: notice.sellerId, permission: 'stores.manage' },
        ],
        triggerEvent: 'reseller_store.auto_paused',
        eventId: `reseller_store_auto_paused:${notice.eventKey}:inapp`,
      });
    } catch (err) {
      this.logger.warn(
        { sellerId: notice.sellerId, err: err instanceof Error ? err.message : String(err) },
        'Auto-pause notice failed; the pause itself stands',
      );
    }
  }

  async stockLow(notice: {
    readonly sellerId: string;
    readonly weekKey: string;
    readonly reorderDays: number;
    readonly items: ReadonlyArray<{
      readonly skuCode: string;
      readonly daysOfStock: string;
      readonly available: number;
    }>;
  }): Promise<void> {
    if (notice.items.length === 0) return;
    const shown = notice.items
      .slice(0, 8)
      .map((i) => `${i.skuCode} (${i.available} left, ~${i.daysOfStock} days)`)
      .join('; ');
    const more = notice.items.length > 8 ? ` and ${notice.items.length - 8} more` : '';
    try {
      await this.dispatch.dispatch({
        topic: RESELLER_STOCK_REORDER_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: `${notice.items.length} product${notice.items.length === 1 ? '' : 's'} your reseller stores sell will run low`,
        body:
          `At the rate they sold recently, stock of ${shown}${more} lasts fewer than ` +
          `${notice.reorderDays} days. Send more stock, or see the forecast on Reseller stores → Stock forecast.`,
        channels: [NotificationChannel.IN_APP],
        audience: [
          { kind: 'SELLER_PERMISSION', sellerId: notice.sellerId, permission: 'stores.reports' },
        ],
        triggerEvent: 'reseller_stock.reorder',
        // At most once a week per seller while stock stays low.
        eventId: `reseller_stock_reorder:${notice.sellerId}:${notice.weekKey}:inapp`,
      });
    } catch (err) {
      this.logger.warn(
        { sellerId: notice.sellerId, err: err instanceof Error ? err.message : String(err) },
        'Reorder notice failed',
      );
    }
  }
}
