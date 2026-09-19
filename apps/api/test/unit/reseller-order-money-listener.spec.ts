import { OrderStatus } from '@skydrop/db';
import {
  ResellerOrderMoneyListener,
  resellerMoneyStepFailedKey,
} from '../../src/modules/reseller-order-money/services/reseller-order-money.listener';
import type { OrderLifecycleEvent } from '../../src/modules/lifecycle-events/order-lifecycle-event-bus.service';

type AnyArgs = Record<string, unknown>;

/**
 * RS-6 phase 3c — a reseller order's money follows it, and when it does
 * NOT, somebody is told (2026-09-19).
 *
 * Every failure here was a HIGH `reseller_order.money_failed` audit row
 * and nothing else, and nothing reads audit rows: a delivered order's
 * store and seller could go uncredited with the first sign being a
 * balance somebody eventually queried. The same defect the re-pricing
 * sweep closes, in the same subsystem, with the same fix — a HIGH MONEY
 * system issue keyed on the order, clearing itself the next time any
 * money step on that order runs.
 */
function make(opts: { onDeliveredThrows?: string } = {}) {
  const onDelivered = jest.fn(async () => {
    if (opts.onDeliveredThrows !== undefined) throw new Error(opts.onDeliveredThrows);
  });
  const money = {
    head: jest.fn(async () => ({
      sellerId: 's1',
      storeId: 'store-1',
      orderNumber: 'SD-A',
      paymentMode: 'COD',
    })),
    onConfirmed: jest.fn(async () => undefined),
    onDelivered,
    onEnded: jest.fn(async () => undefined),
    onReturned: jest.fn(async () => undefined),
  };
  const raise = jest.fn(async (_i: AnyArgs) => undefined);
  const resolveByKey = jest.fn(async (_k: string, _n: string) => 0);
  const audit = { log: jest.fn(async () => 'a1') };
  const client = {
    // `parcelLeftWithCourier` — no handover on record.
    shipment: { count: jest.fn(async () => 0) },
    orderEvent: { findMany: jest.fn(async () => []) },
  };
  const svc = new ResellerOrderMoneyListener(
    { subscribe: jest.fn() } as never,
    money as never,
    { client } as never,
    audit as never,
    { raise, resolveByKey } as never,
  );
  const delivered: OrderLifecycleEvent = {
    orderId: 'o1',
    sellerId: 's1',
    from: OrderStatus.OUT_FOR_DELIVERY,
    to: OrderStatus.DELIVERED,
    statusEventId: 'sc1',
    actorType: 'SYSTEM',
    actorId: null,
    occurredAt: new Date('2026-09-19T00:00:00Z'),
    source: 'TRANSITION',
  } as unknown as OrderLifecycleEvent;
  return { svc, raise, resolveByKey, audit, onDelivered, delivered };
}

describe('ResellerOrderMoneyListener — a money step that failed is RAISED, not just audited', () => {
  it('a failed step raises a HIGH MONEY issue keyed on the order, and never rethrows', async () => {
    const h = make({ onDeliveredThrows: 'wallet lock timeout' });
    await expect(h.svc.handle(h.delivered)).resolves.toBeUndefined();
    expect(h.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MONEY',
        severity: 'HIGH',
        dedupeKey: resellerMoneyStepFailedKey('o1'),
        title: expect.stringContaining('SD-A'),
        metadata: expect.objectContaining({ toStatus: OrderStatus.DELIVERED }),
      }),
    );
  });

  it('the audit row is KEPT — it is the history, not the alarm', async () => {
    const h = make({ onDeliveredThrows: 'boom' });
    await h.svc.handle(h.delivered);
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reseller_order.money_failed', severity: 'HIGH' }),
    );
  });

  it('a step that runs clears the alarm — re-running is the fix, every step is idempotent', async () => {
    const h = make();
    await h.svc.handle(h.delivered);
    expect(h.raise).not.toHaveBeenCalled();
    expect(h.resolveByKey).toHaveBeenCalledWith(
      resellerMoneyStepFailedKey('o1'),
      expect.any(String),
    );
  });
});
