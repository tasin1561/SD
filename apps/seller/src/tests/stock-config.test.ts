import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The switch for a feature that was already enforcing itself.
 *
 * R4 shipped per-unit inventory in full — a serial per unit, scan gates
 * at receiving, pick and pack, a discrepancy report — and nothing in the
 * product could turn it on. `PATCH .../inventory-mode` had zero callers,
 * and the variant page carried no stock config at all, so the per-variant
 * low-stock threshold was equally unreachable.
 *
 * The sharpest evidence it was a real gap rather than an unfinished
 * nicety: the shipped unit-discrepancy screen tells the seller "only SKUs
 * you have set to strict per-unit tracking appear here", about a setting
 * they had no way to set.
 */

const R = (p: string): string => readFileSync(join(__dirname, p), 'utf8');

const PANEL = R(
  '../app/(authed)/catalog/products/[id]/variants/[variantId]/_components/stock-config-panel.tsx',
);
const DETAIL = R(
  '../app/(authed)/catalog/products/[id]/variants/[variantId]/_components/variant-detail.tsx',
);
const HOOKS = R('../lib/api-hooks.ts');
const MODE_DTO = R('../../../api/src/modules/inventory-stock/dto/inventory-mode.dto.ts');
const THRESHOLD_DTO = R('../../../api/src/modules/inventory-stock/dto/threshold.dto.ts');
const CONTROLLERS =
  R('../../../api/src/modules/inventory-stock/seller-inventory-mode.controller.ts') +
  R('../../../api/src/modules/inventory-stock/seller-threshold.controller.ts');

describe('it is actually reachable', () => {
  it('the panel is mounted on the variant page', () => {
    // The whole point. A component that exists and nothing renders is
    // the bug, not the fix.
    expect(DETAIL).toContain('<StockConfigPanel');
    expect(DETAIL).toContain("from './stock-config-panel'");
  });
});

describe('the wire body matches the DTOs', () => {
  it('the mode DTO takes exactly one key, and the client sends that key', () => {
    expect(MODE_DTO).toMatch(/inventoryMode!: InventoryMode \| null;/);
    expect(HOOKS).toContain('readonly inventoryMode: SellerInventoryMode | null;');
  });

  it('the threshold DTO takes exactly one key, and the client sends that key', () => {
    expect(THRESHOLD_DTO).toMatch(/lowStockThreshold!: number \| null;/);
    expect(HOOKS).toContain('readonly lowStockThreshold: number | null;');
  });

  it('the key is always PRESENT — null clears, undefined is a 400', () => {
    // @IsDefined under @ValidateIf accepts an explicit null and rejects
    // undefined, so "omit it to leave it alone" does not work here.
    for (const dto of [MODE_DTO, THRESHOLD_DTO]) {
      expect(dto).toContain('@IsDefined()');
      expect(dto).toMatch(/@ValidateIf\(\(_o, v\) => v !== null\)/);
    }
    expect(PANEL).toContain('inventoryMode: value');
    expect(PANEL).toContain('lowStockThreshold: value');
  });
});

describe('inherit is a third state, not a synonym for normal', () => {
  it('offers three options and sends null for the inherit one', () => {
    // Clearing must be possible: a seller who moves the catalogue to
    // STRICT has to be able to put one SKU back on "whatever the
    // catalogue does" rather than pinning it to NORMAL forever.
    expect(PANEL).toContain('<option value="">Use catalogue default</option>');
    expect(PANEL).toContain('<option value="NORMAL"');
    expect(PANEL).toContain('<option value="STRICT"');
    expect(PANEL).toContain("next === '' ? null");
  });

  it('says which mode is in force when the answer is inherited', () => {
    // "Inherit" alone does not tell anyone whether serials are required
    // today, which is the only thing the warehouse cares about.
    expect(PANEL).toContain('effectiveInventoryMode');
    expect(PANEL).toContain('inherited === true');
  });

  it('a blank threshold clears rather than meaning zero', () => {
    // 0 is a real threshold — "warn me only when it is empty".
    expect(PANEL).toContain("trimmed === '' ? null : parsed");
    expect(PANEL).toContain('0 warns only when it is empty');
  });
});

describe('it shows what is currently set before asking for a new value', () => {
  it('reads the threshold from the by-variant stock endpoint', () => {
    // The variant projection does not carry lowStockThreshold, so
    // without this the control is a box you type into blind.
    expect(HOOKS).toContain('/api/seller/stock/by-variant/');
    expect(PANEL).toContain('useVariantStock(variantId)');
  });

  it('what the seller typed survives a background refetch', () => {
    // Seeding straight from server data on every render throws away an
    // in-progress edit the moment a refetch lands.
    expect(PANEL).toContain('typed ??');
  });
});

describe('it gates on the permission the server enforces', () => {
  it('the server requires catalog.manage on both writes', () => {
    const patches = CONTROLLERS.split('@Patch(').slice(1);
    const modeOrThreshold = patches.filter(
      (b) => b.includes('inventory-mode') || b.includes('threshold'),
    );
    expect(modeOrThreshold.length).toBeGreaterThanOrEqual(2);
    for (const b of modeOrThreshold) {
      expect(b.slice(0, 400)).toContain("@RequireSellerPermissions('catalog.manage')");
    }
  });

  it('the panel asks for catalog.manage, not the page gate', () => {
    // The route is gated catalog.view; these writes need more.
    expect(PANEL).toContain("can(useSellerIdentity(), 'catalog.manage')");
  });

  it('surfaces the server verdict verbatim', () => {
    expect(PANEL).toContain('serverVerdict(err)');
  });
});
