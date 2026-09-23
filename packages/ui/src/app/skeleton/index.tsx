import { clsx } from 'clsx';
import type { CSSProperties, ReactElement } from 'react';
import './skeleton.css';

/**
 * Skeleton — reserves the space content will take and shows its SHAPE,
 * never a spinner. The shimmer is a highlight layer TRANSLATED across the
 * block (transform only); under reduced motion it stops and the block
 * stays as a calm placeholder.
 *
 * API-compatible with the legacy `Skeleton` / `SkeletonRows`
 * (`className`, `rounded`, `rows`, `cols`), plus `width` / `height` for a
 * caller without utility classes.
 */
export function Skeleton({
  className,
  rounded = 'sm',
  width,
  height,
}: {
  readonly className?: string | undefined;
  readonly rounded?: 'sm' | 'md' | 'full';
  readonly width?: string | number | undefined;
  readonly height?: string | number | undefined;
}): ReactElement {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;
  return (
    <span aria-hidden className={clsx('sk-skel', className)} data-rounded={rounded} style={style} />
  );
}

/** N skeleton rows sized to the real column count; announced once as loading. */
export function SkeletonRows({
  rows = 5,
  cols = 4,
  label = 'Loading',
  className,
}: {
  readonly rows?: number;
  readonly cols?: number;
  readonly label?: string;
  readonly className?: string | undefined;
}): ReactElement {
  return (
    <div
      className={clsx('sk-skel-rows', className)}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="sk-skel-rows__row">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton
              key={c}
              className="sk-skel-rows__cell"
              width={c === 0 ? '26%' : c === cols - 1 ? '12%' : '16%'}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
