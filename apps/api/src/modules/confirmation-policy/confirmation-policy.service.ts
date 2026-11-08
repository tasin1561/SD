import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CallQueueService } from '../call-queue/services/call-queue.service';
import { SettingsResolverService } from '../settings/services/settings-resolver.service';
import type { ClientContext } from '../seller-auth/seller-auth.service';

export const SETTING_CALL_CONFIRMATION_REQUIRED = 'ops.call_confirmation_required';
export const SETTING_CALL_AUTO_CONFIRM_TTL_HOURS = 'ops.call_auto_confirm_ttl_hours';
const DEFAULT_TTL_HOURS = 24;

export type EnqueueOrDeferResult = 'ENQUEUED' | 'DEFERRED';

/**
 * Whether a PENDING_CONFIRMATION order is phoned automatically, and the
 * deadline lifecycle for the ones that are not.
 *
 * CC-1 keeps `CallQueueService` free of Order knowledge ("when to
 * enqueue is the CALLER's concern"), so the decision lives here, one hop
 * above the queue, and both post-commit enqueue sites route through it.
 *
 * The setting is resolved for the order's `sellerId` — the CLIENT that
 * owns the stock and pays the return fee. For a reseller-store order that
 * is still the client, never the store: `orders.seller_id` is the client
 * on every order, and the store's own preferences are deliberately not
 * consulted.
 *
 * Fail-safe: if the setting cannot be read, the order is enqueued — the
 * pre-existing behaviour — rather than silently left waiting.
 */
@Injectable()
export class ConfirmationPolicyService {
  private readonly logger = new Logger(ConfirmationPolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly callQueue: CallQueueService,
    private readonly settings: SettingsResolverService,
  ) {}

  /** The client's resolved `ops.call_confirmation_required`; true on any read failure. */
  async callsRequired(sellerId: string): Promise<boolean> {
    try {
      const r = await this.settings.resolve(sellerId, SETTING_CALL_CONFIRMATION_REQUIRED);
      return r.value !== false;
    } catch (e) {
      this.logger.error(
        { sellerId, err: (e as Error).message },
        'Could not resolve ops.call_confirmation_required; defaulting to calls ON',
      );
      return true;
    }
  }

  async ttlHours(sellerId: string): Promise<number> {
    try {
      const r = await this.settings.resolve(sellerId, SETTING_CALL_AUTO_CONFIRM_TTL_HOURS);
      const n = Number(r.value);
      return Number.isFinite(n) && n >= 1 ? n : DEFAULT_TTL_HOURS;
    } catch {
      return DEFAULT_TTL_HOURS;
    }
  }

  /**
   * The CC-6 post-commit entry step. Calls ON (default) → exactly the old
   * behaviour: enqueue, and make sure no stale deadline survives. Calls
   * OFF → no enqueue; the deadline is (re)computed from NOW, which is the
   * entry into PENDING_CONFIRMATION, so a re-entry restarts the clock.
   */
  async enqueueOrDefer(orderId: string, ctx?: ClientContext): Promise<EnqueueOrDeferResult> {
    const order = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      select: { sellerId: true },
    });
    if (order && !(await this.callsRequired(order.sellerId))) {
      const ttl = await this.ttlHours(order.sellerId);
      await this.prisma.client.order.updateMany({
        where: { id: orderId, status: OrderStatus.PENDING_CONFIRMATION },
        data: { confirmationDeadlineAt: new Date(Date.now() + ttl * 3_600_000) },
      });
      return 'DEFERRED';
    }
    await this.callQueue.enqueueOrder(orderId, ctx);
    await this.clearDeadline(orderId);
    return 'ENQUEUED';
  }

  /** Idempotent: clears the TTL clock (order queued for a call, or left PENDING_CONFIRMATION). */
  async clearDeadline(orderId: string): Promise<void> {
    await this.prisma.client.order.updateMany({
      where: { id: orderId, confirmationDeadlineAt: { not: null } },
      data: { confirmationDeadlineAt: null },
    });
  }
}
