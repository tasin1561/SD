/**
 * The money strings a screen renders, in order — the invariant the apps
 * restyle (feat/apps-premium-restyle) must not move.
 *
 * Read from the rendered TEXT and the spoken labels, never from class
 * names: the restyle changes every class on these screens on purpose, and
 * a snapshot keyed on classes would fail for the right change and pass for
 * the wrong one. What it catches is exactly what matters: a figure that
 * renders differently — grouping, decimals, symbol, sign, a missing rate,
 * a restatement that vanished.
 *
 * Text nodes are joined with a space, so two neighbouring cells can never
 * run together into one false figure, and spaces INSIDE a figure are
 * removed afterwards, so a figure split across spans (a dimmed "·67", a
 * separate sign) still reads as the one string a person sees.
 */
// A glyph figure (₹1,234.50, −৳30.75) or a code figure (INR 5000.00),
// which some admin tables still print.
const AMOUNT = /[−\-+]?\s*(?:[₹৳]|\b(?:INR|BDT)\b)\s*\d[\d,]*(?:\s*\.\s*\d+)?/g;
const SPOKEN = /(rupee|taka|credit|debit|owed|owe)/i;

function visibleText(root: HTMLElement): string {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const parts: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '');
  return parts.join(' ').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
}

export function moneyStrings(root: HTMLElement): { shown: string[]; spoken: string[] } {
  const shown = [...visibleText(root).matchAll(AMOUNT)].map((m) =>
    m[0]
      .replace(/\s+/g, ' ')
      .replace(/([₹৳−+-])\s+/g, '$1')
      .trim(),
  );
  const spoken = [...root.querySelectorAll('[aria-label]')]
    .map((el) => el.getAttribute('aria-label') ?? '')
    .filter((label) => SPOKEN.test(label));
  return { shown, spoken };
}
