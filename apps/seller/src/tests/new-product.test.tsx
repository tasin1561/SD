import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { permissionForPath, canSeePath } from '@/lib/page-access';

/**
 * Adding a product by hand.
 *
 * Until now the only way in was a CSV, and `/catalog`'s empty state told
 * sellers to email their account manager. The endpoints existed the
 * whole time; there was no screen calling them.
 *
 * What is worth pinning here is the TWO-CALL problem. Creating a product
 * and its first variant is POST product then POST variant, and if the
 * second fails the first has already happened. A retry that re-POSTs the
 * product leaves a duplicate behind every time — silent, and only
 * visible later as two identical products in the catalogue.
 */

const FORM = join(__dirname, '../app/(authed)/catalog/new/_components/new-product-form.tsx');
const CATALOG_INDEX = join(__dirname, '../app/(authed)/catalog/_components/catalog-index.tsx');
const PRODUCT_DETAIL = join(
  __dirname,
  '../app/(authed)/catalog/products/[id]/_components/product-detail.tsx',
);
const DASHBOARD = join(__dirname, '../app/(authed)/dashboard/_components/dashboard-view.tsx');

const read = (p: string): string => readFileSync(p, 'utf8');

describe('the route is reachable and gated on what the server enforces', () => {
  it('/catalog/new needs catalog.manage, not merely catalog.view', () => {
    // POST /seller/products is guarded by catalog.manage. Resolving this
    // page to catalog.view would open a form that 403s on save.
    expect(permissionForPath('/catalog/new')).toBe('catalog.manage');
  });

  it('a read-only catalogue role cannot open it, but can still browse', () => {
    const viewer = { permissions: ['catalog.view'] };
    expect(canSeePath(viewer, '/catalog/new')).toBe(false);
    expect(canSeePath(viewer, '/catalog')).toBe(true);
  });

  it('the wildcard rule does not swallow it', () => {
    // '/catalog/new' must not be mistaken for a product id.
    expect(permissionForPath('/catalog/products/abc-123')).toBe('catalog.view');
  });
});

describe('the two-call create is retry-safe', () => {
  const src = read(FORM);

  it('does not re-create the product when only the variant failed', () => {
    // The guard is `if (productId === null)`. Without it, pressing the
    // button again after a duplicate-SKU error makes a second product.
    expect(src).toContain('if (productId === null)');
    expect(src).toContain('setCreatedProductId');
  });

  it('tells the seller the product already exists rather than a bare error', () => {
    expect(src).toContain('the product was created');
  });

  it('relabels the button once the product is in, so the retry is honest', () => {
    expect(src).toContain('Retry variant');
  });

  it('omits blank optional numbers instead of sending 0', () => {
    // A declared value of 0 is a customs statement, not "unknown".
    expect(src).toContain("if (t === '') return undefined");
  });

  it('surfaces the server verdict verbatim (FE-2)', () => {
    expect(src).toMatch(/\[\$\{body\.code\}\]/);
  });
});

describe('the entry points a seller actually finds', () => {
  it('/catalog offers New product in the toolbar AND the empty state', () => {
    const src = read(CATALOG_INDEX);
    const hits = src.match(/href="\/catalog\/new"/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it('the empty state no longer tells sellers to email someone', () => {
    // It read: "Use the CSV import or contact your account manager".
    expect(read(CATALOG_INDEX)).not.toContain('account manager');
  });

  it('the dashboard checklist points at the form, not the list it dead-ended on', () => {
    const src = read(DASHBOARD);
    const idx = src.indexOf('Add your first product');
    expect(idx).toBeGreaterThan(-1);
    // Matches the href however it is written: the checklist moved from
    // four hand-written <ChecklistItem href="…"> to a steps array with
    // `href: '…'`, so the destination is an object property now. The
    // thing worth pinning is where it POINTS, not the syntax around it.
    expect(src.slice(idx, idx + 220)).toMatch(/href[:=]\s*['"{]?\/catalog\/new/);
  });

  it('a product with no variants offers to add one', () => {
    const src = read(PRODUCT_DETAIL);
    expect(src).toContain('AddVariantPanel');
    // The old empty state pushed the seller to CSV for a single variant.
    expect(src).not.toMatch(/No variants yet[\s\S]{0,300}CSV import/);
  });
});
