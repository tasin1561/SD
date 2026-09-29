import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ShipmentStatus } from '@skydrop/db';

/**
 * EVERY FILTER ON THE TRACKING SCREEN MUST BE A REAL SHIPMENT STATUS.
 *
 * The list said `DELIVERY_FAILED`, which is an ORDER status. The shipment
 * enum's value is `DELIVERY_ATTEMPTED`, so the tab sent Prisma a value
 * the column cannot hold and the page came back "API 500
 * (INTERNAL_ERROR)" — on the one filter a seller comes to tracking for.
 * The KPI tile counted the same non-existent value and read 0 for ever.
 *
 * Read from the SOURCE rather than by importing the component: it is a
 * client component with a dozen UI imports, and the thing being pinned is
 * a list of string literals. A regex over those literals is the whole
 * check, and it cannot be defeated by the component growing.
 */
const SOURCE = join(process.cwd(), 'src/app/(authed)/tracking/_components/tracking-index.tsx');

describe('the tracking screen’s status filters', () => {
  const src = readFileSync(SOURCE, 'utf8');

  it('names only values the ShipmentStatus enum has', () => {
    const block = /const FILTERS[^=]*=\s*\[([\s\S]*?)\];/.exec(src);
    expect(block, 'FILTERS list not found — has it been renamed?').not.toBeNull();

    const values = [...(block?.[1] ?? '').matchAll(/\[\s*'([^']*)'/g)]
      .map((m) => m[1] ?? '')
      .filter((v) => v !== '');
    expect(values.length).toBeGreaterThan(0);

    const allowed = new Set(Object.keys(ShipmentStatus));
    expect(values.filter((v) => !allowed.has(v))).toEqual([]);
  });

  it('counts a status the enum has, for the "delivery failed" tile', () => {
    const counted = [...src.matchAll(/r\.status === '([A-Z_]+)'/g)].map((m) => m[1] ?? '');
    const allowed = new Set(Object.keys(ShipmentStatus));
    expect(counted.filter((v) => !allowed.has(v))).toEqual([]);
  });
});
