import { clsx } from 'clsx';
import { forwardRef, type ButtonHTMLAttributes, type ReactElement } from 'react';

/**
 * Single button primitive — variants drive the look. NO admin-
 * specific behavior; the consuming page wires onClick / form
 * semantics. Extraction-ready (no `@/...` imports).
 *
 * Variants:
 *   primary    — filled accent (sparingly used; primary CTAs only)
 *   secondary  — bordered, body-text color (default for action buttons)
 *   ghost      — no border, hover bg only (toolbar buttons)
 *   destructive — red border + text (delete, suspend)
 *   override   — the god-mode color (critical red, deliberately
 *                stronger than 'destructive' to convey gravity)
 *
 * Sizes:
 *   sm   — dense table-row buttons (the default for utilitarian admin)
 *   md   — page-action buttons
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'override';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly size?: Size;
}

const baseClasses =
  'skydrop-hit inline-flex items-center justify-center gap-1.5 rounded-[5px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

const sizeClasses: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
};

const variantClasses: Record<Variant, string> = {
  primary: 'bg-accent-fill text-accent-fg hover:bg-accent-fill-hover',
  secondary:
    'border border-border bg-surface text-text-body hover:border-border-strong hover:text-text-bright',
  ghost: 'text-text-muted hover:bg-surface-hover hover:text-text-body',
  destructive:
    'border border-[var(--color-critical-ring)] text-critical bg-[var(--color-critical-tint)] hover:bg-[color-mix(in_srgb,var(--color-critical-tint),transparent_50%)]',
  override: 'bg-critical text-white border border-critical hover:opacity-90',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'sm', className, type = 'button', ...rest },
  ref,
): ReactElement {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(baseClasses, sizeClasses[size], variantClasses[variant], className)}
      {...rest}
    />
  );
});
