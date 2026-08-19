import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Two more capabilities the server had and nothing could reach.
 *
 * All found by the same sweep, all the same shape: an endpoint shipped,
 * a permission defined for it, and no screen calling it. That combination
 * is invisible to every behavioural test, because no behaviour reaches
 * the code — so these read the source.
 *
 * A third — closing a DISCREPANCY receipt — was RETIRED rather than
 * fixed. A variance no longer blocks: `complete` writes stock for what
 * was counted and records the gap on the receipt, so there is nothing
 * left to close and no endpoint to reach. The assertions that pinned it
 * went with the status (docs/consignment-two-leg.md, decision 5).
 *
 *   Stock adjustments     — INV-8's approval queue had a reader and no
 *                           writer, so above-threshold stock could not be
 *                           corrected at all.
 *   Catalog archive       — a seller could add to their catalogue and
 *                           never take anything out of it.
 */

const R = (p: string): string => readFileSync(join(__dirname, p), 'utf8');

const ADJ_PANEL = '../app/(authed)/inventory/adjustments/_components/new-adjustment-panel.tsx';
const ADJ_INDEX = '../app/(authed)/inventory/adjustments/_components/adjustments-index.tsx';
const INV_HOOKS = '../lib/inventory-hooks.ts';
const SELLER_PRODUCT =
  '../../../seller/src/app/(authed)/products/[id]/_components/product-detail.tsx';
const SELLER_HOOKS = '../../../seller/src/lib/api-hooks.ts';

describe('a stock adjustment can be raised', () => {
  const src = R(ADJ_PANEL);

  it('the panel is mounted on the adjustments page', () => {
    expect(R(ADJ_INDEX)).toContain('<NewAdjustmentPanel />');
  });

  it('carries all three ids, because stock is held per variant/bin/batch', () => {
    // An adjustment naming only a SKU cannot be applied to anything.
    for (const f of ['variantId', 'binId', 'batchId']) expect(src).toContain(f);
    expect(src).toMatch(/complete =[\s\S]{0,200}batchId\.trim\(\) !== ''/);
  });

  it('derives the sign from the direction rather than from what was typed', () => {
    // The server rejects a type/sign mismatch, and "-5" on a DECREASE
    // means the same as "5" — guessing wrong moves stock the wrong way.
    expect(src).toContain("type === 'DECREASE' ? -qtyNum : qtyNum");
    expect(src).toContain('Math.abs(Number(qty))');
  });

  it('reports whether it applied or queued, which is INV-8’s whole point', () => {
    expect(src).toContain("result.status === 'PENDING'");
    expect(src).toContain('waiting for approval');
  });

  it('is gated on the create permission', () => {
    expect(src).toContain("usePermission('inventory.adjustments.create')");
    expect(src).toMatch(/if \(!mayCreate\) return null;/);
  });

  it('creating invalidates inventory — below threshold it applies at once', () => {
    const hooks = R(INV_HOOKS);
    const hook = hooks.slice(hooks.indexOf('export function useCreateAdjustment('));
    expect(hook.slice(0, 1200)).toContain("['admin-inventory']");
  });
});

describe('a seller can retire a product', () => {
  it('the product page offers archive and restore', () => {
    const src = R(SELLER_PRODUCT);
    expect(src).toContain('Archive product');
    expect(src).toContain('Restore product');
  });

  it('archive is the offered action, not delete', () => {
    // ARCHIVED blocks new orders and receiving while keeping history;
    // delete hides the row from read paths and is staff-recoverable only.
    const src = R(SELLER_PRODUCT);
    expect(src).not.toMatch(/Delete product/i);
  });

  it('says that restoring does NOT bring the variants back', () => {
    // Archiving a product cascades to variants; unarchiving does not.
    // Which ones should live again is a decision, not an inference.
    expect(R(SELLER_PRODUCT)).toContain('variants stay archived');
  });

  it('both hooks hit the archive/unarchive routes', () => {
    const hooks = R(SELLER_HOOKS);
    expect(hooks).toContain("archived ? 'archive' : 'unarchive'");
    expect(hooks).toContain('export function useArchiveProduct(');
    expect(hooks).toContain('export function useArchiveVariant(');
  });
});
