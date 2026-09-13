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
 * `alt` defaults to empty: the product name sits immediately beside it
 * in most call sites, so announcing it again is duplication a screen
 * reader has to listen through. Pass one when the picture is the whole
 * content of something (a link that opens it).
 *
 * Lazy-loaded: these sit down long lists, and a presigned URL is only
 * worth fetching once somebody scrolls to it.
 */
export function ProductThumb({
  src,
  size = 44,
  alt = '',
}: {
  readonly src: string | null;
  readonly size?: number;
  readonly alt?: string;
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
      alt={alt}
      loading="lazy"
      decoding="async"
      style={box}
      className="border-border shrink-0 rounded-[4px] border object-cover"
    />
  );
}
