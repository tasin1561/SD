'use client';

import { clsx } from 'clsx';
import type { ReactElement } from 'react';

/**
 * An on/off switch.
 *
 * A `role="switch"` BUTTON rather than a styled checkbox. Both are
 * accessible when done properly, but a checkbox says "this is one of
 * several things you are selecting" and a switch says "this takes
 * effect now" — which is what every one of these does: there is no Save
 * button on the settings page, each flip is a request.
 *
 * The knob moves with a transform rather than a layout property, so it
 * cannot cause a reflow in a list of twenty of them, and the global
 * reduced-motion rule in tokens.css collapses it to an instant.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  className,
}: {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  /** What is being switched. Announced — never rely on the row alone. */
  readonly label: string;
  readonly disabled?: boolean;
  readonly className?: string;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'skydrop-hit relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent-fill' : 'bg-border-strong',
        className,
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[1.125rem]' : 'translate-x-[0.1875rem]',
        )}
      />
    </button>
  );
}
