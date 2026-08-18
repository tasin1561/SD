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
    // Case-insensitive: the sentence moved to the front of the message
    // when it grew to name the variants that failed, and capitalisation
    // is not the behaviour being pinned.
    expect(src.toLowerCase()).toContain('the product was created');
  });

  it('relabels the button once the product is in, so the retry is honest', () => {
    // "Create product" on a second press would be a lie — the product
    // exists and only the missing variants are re-sent.
    expect(src).toContain('Add the missing variants');
  });

  it('does not re-send variants that already landed', () => {
    // With N variants a partial failure is normal: three of six saved.
    // Re-sending the three that worked would fail them all on a
    // duplicate SKU and strand the product.
    expect(src).toContain('savedSkus');
    expect(src).toContain('if (landed[sku] === true) continue');
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

/**
 * A shoe comes in Red and Blue, in sizes 40-42. That is six orderable
 * things, six SKUs and six stock counts — not two colours with sizes
 * hanging off them. Stock is counted against a variant and a picker
 * picks a physical pair, so "Red" is a VALUE on the row rather than a
 * level above it.
 */
describe('variants are built from options, not typed out', () => {
  const src = read(FORM);

  // How the combinations are generated is asserted on the OUTPUT in
  // variant-matrix.test.ts — counts, per-colour sizes, distinct SKUs.
  // The two greps that used to live here matched internal names and
  // broke on a rename that changed no behaviour, which is exactly the
  // failure a source-text test cannot tell from a real one.

  it('records the option values STRUCTURALLY, not just in the label', () => {
    // `attributes` is what makes "show me the Reds" answerable later. A
    // free-text label like "Red / 40" reads the same to a human and is
    // nothing to a query.
    expect(src).toContain('attributes: r.values');
  });

  it('keeps a row edited by the seller when another option is added', () => {
    // Rows are keyed on their VALUES, not their index — otherwise adding
    // a size renumbers everything and moves the SKUs the seller typed
    // onto the wrong colours.
    expect(src).toContain('key: parts.join');
    expect(src).toContain('skuEdits[r.key]');
  });

  it('refuses two variants sharing a SKU before the server has to', () => {
    // Not a client-side mirror of a server rule (FE-2): the server sees
    // one POST at a time and cannot see the collision inside one form.
    expect(src).toContain('is used twice');
  });
});

describe('the physical block is asked once, at product level', () => {
  const src = read(FORM);

  it('sends the product defaults rather than stamping every variant', () => {
    // M4 resolves `variant.field ?? product.defaultField`, so a blank
    // variant inherits. Six sizes of one shoe share all four fields.
    for (const f of [
      'defaultWeightGrams',
      'defaultLengthCm',
      'defaultWidthCm',
      'defaultHeightCm',
      'defaultDeclaredValueInr',
    ]) {
      expect(src).toContain(f);
    }
  });

  it('does NOT put physical fields on the variant, so inheritance is live', () => {
    // Copying the product's values onto each variant would look
    // identical on screen and freeze them: changing the product default
    // afterwards would move nothing.
    expect(src).not.toMatch(/body: \{[^}]*weightGrams:/s);
  });
});

/**
 * The product id reaches useCreateVariant as a MUTATION VARIABLE.
 *
 * Bound at render it was a live bug: this form does not know the id
 * until its own first call returns, so it passed '' and the variant POST
 * went to `/seller/products//variants`. Setting state right before
 * calling does not help — the mutation in that closure already captured
 * the old value — so the FIRST save of every new product failed and only
 * a second attempt worked.
 */
describe('the variant call is bound to a product id that exists', () => {
  it('takes the product id per call, not per render', () => {
    const hooks = read(join(__dirname, '../lib/api-hooks.ts'));
    expect(hooks).toContain('mutationFn: ({ productId, body })');
    expect(hooks).not.toContain('export function useCreateVariant(\n  productId: string,\n)');
  });

  it('the form never constructs the hook with a placeholder id', () => {
    const src = read(FORM);
    expect(src).toContain('useCreateVariant()');
    expect(src).not.toContain("useCreateVariant(createdProductId ?? '')");
  });
});

/**
 * Reusing a product code ADDS to that product.
 *
 * Before this, the only way to add a colour was to find the product and
 * use its own Add-variant panel; typing its code here silently created a
 * SECOND product with the same name, which is exactly the split the code
 * exists to prevent on a CSV re-upload. The form now follows the same
 * rule the importer does, where the seller can see it.
 */
describe('an existing product code attaches instead of duplicating', () => {
  const src = read(FORM);

  it('matches the code EXACTLY, not as a search hit', () => {
    // `search` also matches name and SKU, so a fuzzy hit would attach
    // variants to whatever product happened to rank first.
    expect(src).toContain("(p.externalRef ?? '').toLowerCase() === codeQuery.toLowerCase()");
  });

  it('creates no product when one already carries the code', () => {
    expect(src).toContain('createdProductId ?? matched?.id ?? null');
  });

  it('stops demanding a name it is not going to use', () => {
    expect(src).toContain('matched === null && !form.name.trim()');
  });

  it('shows the inherited physical values instead of copying them onto the variants', () => {
    // Copying would look identical and freeze them: changing the product
    // default afterwards would then move nothing.
    expect(src).toContain('inherited === null ? form.weightGrams');
    expect(src).toContain('disabled={inherited !== null}');
  });
});

describe('HS code is gone from the form', () => {
  it('does not ask for it', () => {
    expect(read(FORM)).not.toContain('hsCode');
  });
});

/**
 * An option that is only a PLACEHOLDER is not an option.
 *
 * Two empty option blocks render as "Colour" and "Red" in grey, which
 * reads exactly like two declared values — so the form built one variant
 * and looked like it had ignored the input. The fields are unchanged;
 * what changed is that the screen now says which ones are not counted
 * and why.
 */
describe('an incomplete option says so instead of looking filled in', () => {
  const src = read(FORM);

  it('marks an option that has no name or no value as not counted', () => {
    expect(src).toContain('Not counted yet');
    expect(src).toContain('const incomplete = !named || !filled');
  });

  it('says the greyed-out text is an example', () => {
    // The whole misread. Naming it directly is cheaper than any amount
    // of restyling the placeholder.
    expect(src).toContain('an example, not something you have entered');
    expect(src).toContain('placeholder="e.g. Colour"');
  });

  it('explains a count of one when options exist but none are usable', () => {
    // Case-insensitive: the sentence moved to the start of its own line
    // in the redesign, and capitalisation is not the behaviour pinned.
    expect(src.toLowerCase()).toContain('no option is complete yet');
  });

  it('refuses two options sharing a name', () => {
    // They collide in the attributes map — the second overwrites the
    // first, so the rows multiply while recording only one axis. The
    // SKUs would look right and the data would be wrong.
    expect(src).toContain('Two options share a name');
  });
});

/**
 * The two steps are separate cards for a reason: defining what a product
 * varies BY is a different question from reviewing what that produces,
 * and one dense block made the second look like more of the first.
 */
describe('options and variants are two steps, not one block', () => {
  const src = read(FORM);

  it('renders the generated variants through the Table primitive', () => {
    // Not a stacked list of divs: <Table> carries the header row, the
    // dividers, and the below-md card layout every other table in the
    // portal already inherits (FE-7).
    expect(src).toContain('<THead>');
    expect(src).toContain('<TBody>');
    expect(src).toMatch(/<Th[ >]/);
  });

  it('creates every generated row — no per-row include checkbox', () => {
    // An option value the seller typed IS a variant they stock; making
    // them then tick it was asking the same question twice. A row they
    // do not want is a value they should delete in step 1.
    expect(src).not.toContain('setExcluded');
    expect(src).not.toContain('setAllIncluded');
    expect(src).not.toContain('Include every variant');
  });

  it('stops offering a third option', () => {
    // Only the second axis can hold a list per value of the first, so a
    // third has no unambiguous place to sit.
    expect(src).toContain('options.length < MAX_OPTIONS');
    expect(src).toContain('const MAX_OPTIONS = 2');
  });

  it('gives every option value its own remove control', () => {
    // Deleting a mistyped value beats blanking it — a blank input still
    // occupies the row and reads as one more value left unfilled.
    expect(src).toContain('removeOptionValue');
    expect(src).toContain('removeParentValue');
  });

  it('has no toggle for per-value lists — the second axis is always per-value', () => {
    // The answer was predictable often enough that asking was one more
    // control to understand before the form could be used.
    expect(src).not.toContain('role="switch"');
    expect(src).not.toContain('setPerParent');
    expect(src).toContain('p.length === 1 ? {} : null');
  });

  it('seeds a new first-axis value from a sibling that already has a list', () => {
    // Adding Yellow after typing Red 38-42 must hand over 38-42 to edit
    // down. Without this, always-on per-value lists would mean retyping
    // the range for every colour — worse than the toggle it replaced.
    expect(src).toContain(".find((vs) => vs.some((v) => v.trim() !== ''))");
  });

  it('uses the shared Button for every action — no bare text links', () => {
    // "+ value" and "Remove" were plain text beside boxed inputs, which
    // is what made the controls read as unrelated.
    expect(src).toContain('Add value');
    expect(src).toContain('variant="ghost"');
    expect(src).toContain('variant="secondary"');
  });
});

describe('the save action looks like the point of the page', () => {
  const src = read(FORM);

  it('is the PRIMARY button, not another secondary beside Cancel', () => {
    // Button defaults to variant 'secondary', size 'sm' — so an unadorned
    // submit rendered identically to Cancel, reading as a second way to
    // leave rather than the way to finish.
    expect(src).toContain('type="submit" variant="primary" size="md"');
  });

  it('stays reachable on a long form', () => {
    // A dozen generated rows push the actions well below the fold.
    expect(src).toContain('sticky bottom-0');
  });

  it('folds the safe-area inset into one padding declaration', () => {
    // FE-7: an inline env() style on an element that also carries a
    // padding utility wins outright and erases it on every phone.
    expect(src).toContain('pb-[calc(0.75rem+env(safe-area-inset-bottom))]');
    expect(src).not.toMatch(/style=\{\{[^}]*safe-area-inset/);
  });
});
