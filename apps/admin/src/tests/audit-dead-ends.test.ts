import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Three more capabilities the server had and nothing could reach.
 *
 * All found by the same sweep, all the same shape: an endpoint shipped,
 * a permission defined for it, and no screen calling it. That combination
 * is invisible to every behavioural test, because no behaviour reaches
 * the code — so these read the source.
 *
 *   DISCREPANCY receipts  — a short consignment wrote NO stock and could
 *                           never be closed. Goods on the floor the
 *                           system would not admit had arrived.
 *   Stock adjustments     — INV-8's approval queue had a reader and no
 *                           writer, so above-threshold stock could not be
 *                           corrected at all.
 *   Catalog archive       — a seller could add to their catalogue and
 *                           never take anything out of it.
 */

const R = (p: string): string => readFileSync(join(__dirname, p), 'utf8');

const RECEIVE = '../app/(authed)/warehouse/receive/_components/receive-detail-view.tsx';
const ADJ_PANEL = '../app/(authed)/inventory/adjustments/_components/new-adjustment-panel.tsx';
const ADJ_INDEX = '../app/(authed)/inventory/adjustments/_components/adjustments-index.tsx';
const ADMIN_HOOKS = '../lib/api-hooks.ts';
const INV_HOOKS = '../lib/inventory-hooks.ts';
const SELLER_PRODUCT =
  '../../../seller/src/app/(authed)/catalog/products/[id]/_components/product-detail.tsx';
const SELLER_HOOKS = '../../../seller/src/lib/api-hooks.ts';

describe('a DISCREPANCY receipt can be closed', () => {
  const src = R(RECEIVE);

  it('the panel renders for DISCREPANCY only', () => {
    expect(src).toContain("r.status === 'DISCREPANCY'");
    expect(src).toContain('{isDiscrepancy && (');
  });

  it('a note is mandatory — it is the only record of why numbers differ', () => {
    expect(src).toContain("forceNote.trim() === ''");
    expect(src).toContain('mode: ');
    expect(src).toContain("'FORCE_COMPLETE'");
  });

  it('resolving invalidates inventory, because it writes stock', () => {
    const hooks = R(ADMIN_HOOKS);
    const hook = hooks.slice(hooks.indexOf('export function useResolveDiscrepancy('));
    expect(hook.slice(0, 900)).toContain("['admin-inventory']");
  });
});

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
