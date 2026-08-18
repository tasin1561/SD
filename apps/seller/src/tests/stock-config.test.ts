import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What a seller may configure on a SKU — and what they may not.
 *
 * R4 shipped per-unit inventory in full (a serial per unit, scan gates at
 * receiving, pick and pack, a discrepancy report) with nothing in the
 * product to turn it on, so this panel was built to close that gap. On
 * 2026-08-19 the mode HALF was taken back out: it decides whether our
 * staff must scan a serial for every physical unit, which is our
 * operating procedure rather than a seller preference. A seller flipping
 * it changes what the floor must do with every parcel of theirs, and
 * pins their picks to refusal for SKUs nobody serialised.
 *
 * So the tests below pin two different things: that the low-stock
 * threshold IS still theirs, and that the mode is NOT — in the UI and,
 * more importantly, on the wire.
 */

const R = (p: string): string => readFileSync(join(__dirname, p), 'utf8');

const PANEL = R(
  '../app/(authed)/catalog/products/[id]/variants/[variantId]/_components/stock-config-panel.tsx',
);
const DETAIL = R(
  '../app/(authed)/catalog/products/[id]/variants/[variantId]/_components/variant-detail.tsx',
);
const HOOKS = R('../lib/api-hooks.ts');
const THRESHOLD_DTO = R('../../../api/src/modules/inventory-stock/dto/threshold.dto.ts');
const MODE_CONTROLLER = R(
  '../../../api/src/modules/inventory-stock/seller-inventory-mode.controller.ts',
);
const THRESHOLD_CONTROLLER = R(
  '../../../api/src/modules/inventory-stock/seller-threshold.controller.ts',
);

describe('it is actually reachable', () => {
  it('the panel is mounted on the variant page', () => {
    // A component that exists and nothing renders is the bug, not the fix.
    expect(DETAIL).toContain('<StockConfigPanel');
    expect(DETAIL).toContain("from './stock-config-panel'");
  });
});

describe('unit tracking is not the seller’s to set', () => {
  it('the panel offers no mode control at all', () => {
    expect(PANEL).not.toContain('Unit tracking');
    expect(PANEL).not.toContain('Use catalogue default');
    expect(PANEL).not.toContain('inventoryMode: value');
  });

  it('the WRITE is gone from the server, not merely hidden in the UI', () => {
    // FE-2: the UI is cosmetic and the server is the boundary. Hiding a
    // control while leaving its endpoint open is a request away from the
    // old behaviour.
    expect(MODE_CONTROLLER).not.toContain('@Patch');
  });

  it('the client keeps no setter for it either', () => {
    expect(HOOKS).not.toContain('useSetVariantInventoryMode');
  });

  it('the READ stays — a seller should see when their SKU is on strict', () => {
    // Knowing why picks demand serials is theirs; choosing it is not.
    expect(MODE_CONTROLLER).toContain('@Get(');
    expect(PANEL).toContain('effectiveInventoryMode');
  });
});

describe('the low-stock threshold IS the seller’s', () => {
  it('the DTO takes exactly one key, and the client sends that key', () => {
    expect(THRESHOLD_DTO).toMatch(/lowStockThreshold!: number \| null;/);
    expect(HOOKS).toContain('readonly lowStockThreshold: number | null;');
  });

  it('the key is always PRESENT — null clears, undefined is a 400', () => {
    // @IsDefined under @ValidateIf accepts an explicit null and rejects
    // undefined, so "omit it to leave it alone" does not work here.
    expect(THRESHOLD_DTO).toContain('@IsDefined()');
    expect(THRESHOLD_DTO).toMatch(/@ValidateIf\(\(_o, v\) => v !== null\)/);
    expect(PANEL).toContain('lowStockThreshold: value');
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
  it('the threshold write requires catalog.manage', () => {
    const patches = THRESHOLD_CONTROLLER.split('@Patch(').slice(1);
    expect(patches.length).toBeGreaterThanOrEqual(1);
    for (const b of patches) {
      expect(b.slice(0, 400)).toContain("@RequireSellerPermissions('catalog.manage')");
    }
  });

  it('the panel asks for catalog.manage, not the page gate', () => {
    // The route is gated catalog.view; the write needs more.
    expect(PANEL).toContain("can(useSellerIdentity(), 'catalog.manage')");
  });

  it('surfaces the server verdict verbatim', () => {
    expect(PANEL).toContain('serverVerdict(err)');
  });
});
