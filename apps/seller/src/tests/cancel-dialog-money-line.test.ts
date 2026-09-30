import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The cancel dialog's money line had nothing supplying it.
 *
 * `CancelOrderDialog` takes an optional `chargedInr` and renders "The
 * delivery fee of ₹X already charged for this order goes back to your
 * wallet" when it is set — the paragraph its own docblock calls "the
 * reason this is not a plain confirm: the seller is owed something back
 * and should see the number before agreeing, not discover it in the
 * ledger afterwards."
 *
 * `order-detail.tsx` is its ONLY caller and never passed it. So the
 * prop was always `undefined`, the paragraph never rendered for
 * anybody, and nothing failed: an optional prop nobody supplies is
 * indistinguishable from one that is legitimately absent. Found by
 * filming the cancel flow (2026-09-30).
 *
 * A render test cannot catch this — hand the dialog a `chargedInr` and
 * it works perfectly, which is the whole problem. What was missing is
 * the WIRE between the two files, so this reads the source of both. The
 * shape generalises: when a component branches on an optional prop,
 * somebody has to be supplying it, and only the call site knows.
 */
const dir = path.join(__dirname, '..', 'app', '(authed)', 'orders', '_components');
const read = (f: string): string => readFileSync(path.join(dir, f), 'utf8');

describe('the cancel dialog is told what the order has already cost', () => {
  it('renders its money line from a prop, on a figure above zero', () => {
    const dialog = read('cancel-order-dialog.tsx');
    expect(dialog).toContain('chargedInr != null && Number(chargedInr) > 0');
    expect(dialog).toContain('goes back to your wallet');
  });

  it('is handed that figure by the page that opens it', () => {
    const detail = read('order-detail.tsx');
    const open = detail.indexOf('<CancelOrderDialog');
    expect(open).toBeGreaterThan(-1);
    const props = detail.slice(open, detail.indexOf('/>', open));
    expect(props).toContain('chargedInr=');
  });

  it('takes it from the server rather than working it out on the client', () => {
    /*
      The refund credits the ORIGINAL wallet entry's amount and says why
      in its own words: re-deriving it "would let the two sides drift the
      day someone adds a charge type, and the seller would be refunded a
      different number from the one they were charged". A screen that
      summed the charge rows itself would be that drift with the worse
      symptom — one number read, another credited.
    */
    const detail = read('order-detail.tsx');
    const open = detail.indexOf('<CancelOrderDialog');
    const props = detail.slice(open, detail.indexOf('/>', open));
    expect(props).toMatch(/chargedInr=\{detail\.data\.chargedInr/);
  });
});
