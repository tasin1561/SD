import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Getting an order out of the two states it could enter and never leave.
 *
 * Both matrix edges existed from M6/M9 and neither had a driver:
 *
 *   OUT_OF_STOCK → CONFIRMED — the schema comment promises "Module 7
 *   retries", but the order is dequeued from the call queue on its way
 *   out of PENDING_CONFIRMATION, so Module 7 never sees it again.
 *
 *   PENDING_MANUAL_PLACEMENT → PENDING_PICK — the remedy the manual
 *   placement service NAMES in its own refusal message, and which the
 *   pick queue made unreachable by selecting only CONFIRMED and
 *   PENDING_PICK.
 *
 * A matrix edge with no driver is invisible to every test that exercises
 * behaviour, because no behaviour reaches it. These read the source.
 */

const R = (p: string): string => readFileSync(join(__dirname, p), 'utf8');

const CONTROLLER = '../../../api/src/modules/order/controllers/admin-order.controller.ts';
const PANEL = '../app/(authed)/orders/_components/stuck-order-recovery.tsx';
const DETAIL = '../app/(authed)/orders/_components/order-detail.tsx';
const HOOKS = '../lib/api-hooks.ts';

describe('the endpoints exist and drive the right edge', () => {
  const src = R(CONTROLLER);

  it('retry-stock transitions to CONFIRMED, letting the reserve saga decide', () => {
    const block = src.slice(src.indexOf("':id/retry-stock'"), src.indexOf("':id/return-to-pick'"));
    expect(block).toContain('to: OrderStatus.CONFIRMED');
    // No pre-check that stock exists: RESERVE_STOCK is the check and its
    // failure route is OUT_OF_STOCK, which is where the order already
    // is. A guard here would only be able to disagree with it.
    expect(block).not.toMatch(/qtyAvailable|checkStock/);
  });

  it('return-to-pick transitions to PENDING_PICK', () => {
    const block = src.slice(
      src.indexOf("':id/return-to-pick'"),
      src.indexOf("':id/force-mutation'"),
    );
    expect(block).toContain('to: OrderStatus.PENDING_PICK');
  });

  it('neither is god-mode — both go through the ordinary state machine', () => {
    // The whole point is that these are legal edges nobody had wired.
    // Reaching for forceMutate would have bypassed the reserve saga.
    const block = src.slice(src.indexOf("':id/retry-stock'"), src.indexOf("':id/force-mutation'"));
    expect(block).toContain('this.orderWrite.transitionStatus');
    expect(block).not.toContain('forceMutate');
  });

  it('both are permission-gated', () => {
    const block = src.slice(src.indexOf("':id/retry-stock'"), src.indexOf("':id/force-mutation'"));
    expect(block.match(/@RequirePermissions\(/g) ?? []).toHaveLength(2);
  });
});

describe('the panel is reachable and appears only when stuck', () => {
  it('is mounted on the order detail page', () => {
    expect(R(DETAIL)).toContain('<StuckOrderRecovery');
  });

  it('renders nothing for a healthy order', () => {
    const src = R(PANEL);
    expect(src).toContain("orderStatus === 'OUT_OF_STOCK'");
    expect(src).toContain("orderStatus === 'PENDING_MANUAL_PLACEMENT'");
    expect(src).toMatch(/if \(!isOutOfStock && !isManualPlacement\) return null;/);
  });

  it('offers each action only for the state it applies to', () => {
    const src = R(PANEL);
    expect(src).toMatch(/\{isOutOfStock && \(/);
    expect(src).toMatch(/\{isManualPlacement && \(/);
  });

  it('gates on the permission, not the page gate', () => {
    // /orders is gated on orders.view; these two write.
    const src = R(PANEL);
    expect(src).toContain("usePermission('orders.cancel')");
    expect(src).toMatch(/if \(!mayAct\) return null;/);
  });

  it('reports the status the SERVER returned, not an assumed one', () => {
    // A retry can legitimately bounce straight back to OUT_OF_STOCK.
    // Claiming success would be a lie the operator acts on.
    const src = R(PANEL);
    expect(src).toContain("r.status === 'OUT_OF_STOCK'");
    expect(src).toContain('Still nothing to reserve');
  });

  it('surfaces a refusal verbatim (FE-2)', () => {
    expect(R(PANEL)).toContain('serverVerdict(err)');
  });
});

describe('cache follows the state change', () => {
  it('a successful retry invalidates inventory too — it reserved stock', () => {
    const src = R(HOOKS);
    const hook = src.slice(src.indexOf('export function useRetryStock('));
    expect(hook.slice(0, 900)).toContain("['admin-orders']");
    expect(hook.slice(0, 900)).toContain("['admin-inventory']");
  });
});
