import type { ReactElement } from 'react';

/**
 * The product picture beside a line — picker rows, order items, the edit
 * page's read-only lines.
 *
 * Every source is a PRESIGNED url minted at read time (the bucket has
 * been private since 2026-07-28), so it expires; nothing here may cache
 * it or store it. Renders a plain neutral tile when a variant has no
 * image rather than an alt-text stub, because a missing photograph is
 * not an error worth a row of broken-image glyphs down a list.
 *
 * `alt` is empty on purpose: the product name sits immediately beside it
 * in every call site, so announcing it again is duplication a screen
 * reader has to listen through.
 */
export function ProductThumb({
  src,
  size = 44,
}: {
  readonly src: string | null;
  readonly size?: number;
}): ReactElement {
  const box = { width: size, height: size };
  if (src === null) {
    return (
      <span
        style={box}
        className="border-border bg-surface-raised shrink-0 rounded-[4px] border"
        aria-hidden
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      style={box}
      className="border-border shrink-0 rounded-[4px] border object-cover"
    />
  );
}
