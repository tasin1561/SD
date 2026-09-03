import type { ReactElement } from 'react';

export interface Barcode128Props {
  /**
   * Alternating bar/space widths in MODULES, starting with a bar —
   * exactly what the server's `encodeCode128B` returns.
   *
   * The widths arrive already encoded on purpose. Code 128 has a
   * checksum and a character table, and a second implementation that
   * disagrees would not fail loudly: it would print a barcode that
   * scans as a DIFFERENT value than the text beside it, which is the
   * one outcome worse than no barcode at all. So the encoding lives in
   * one tested place on the server and this component only draws.
   */
  readonly widths: readonly number[];
  /** Printed height of the bars. Quiet zones are added around them. */
  readonly heightMm?: number;
  /** Width of ONE module. 0.33mm ≈ the narrowest most scanners read
   *  reliably off a laser-printed label. */
  readonly moduleMm?: number;
  readonly className?: string;
  /** The human-readable value, for screen readers and for a person
   *  reading a smudged label. Rendered by the caller, not here. */
  readonly label?: string;
}

/**
 * A Code 128 symbol, drawn from pre-encoded module widths.
 *
 * SVG rather than canvas because it has to survive a print at whatever
 * DPI the bench printer runs at, and vectors do; a canvas bitmap sized
 * for the screen prints as a blurred smear that scanners refuse.
 */
export function Barcode128({
  widths,
  heightMm = 12,
  moduleMm = 0.33,
  className,
  label,
}: Barcode128Props): ReactElement | null {
  if (widths.length === 0) return null;

  // A Code 128 symbol needs clear space either side or a scanner reads
  // the label's edge as part of the code. The spec says 10 modules.
  const QUIET = 10;
  const total = widths.reduce((n, w) => n + w, 0) + QUIET * 2;

  const bars: Array<{ x: number; w: number }> = [];
  let x = QUIET;
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w }); // even index = bar, odd = space
    x += w;
  });

  return (
    <svg
      className={className}
      width={`${(total * moduleMm).toFixed(2)}mm`}
      height={`${heightMm}mm`}
      viewBox={`0 0 ${total} ${heightMm}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label === undefined ? 'barcode' : `barcode ${label}`}
    >
      {/* An explicit white ground: a label printed onto a themed page
          would otherwise inherit a dark background and be unscannable. */}
      <rect x={0} y={0} width={total} height={heightMm} fill="#fff" />
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={heightMm} fill="#000" />
      ))}
    </svg>
  );
}
