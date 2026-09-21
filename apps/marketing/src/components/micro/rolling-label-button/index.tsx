'use client';

import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { Check, LoaderCircle, OctagonX, Upload } from 'lucide-react';
import type { AsyncPhase } from '../use-async-state';
import '../micro.css';
import './rolling-label-button.css';

export interface RollingLabels {
  idle: string;
  busy: string;
  success: string;
  error: string;
}

/**
 * 5 · Rolling-label state button. The four labels sit in a strip that
 * rolls vertically to the current PHASE; the icon spins only while busy.
 * Also the ≤350 ms press feedback on a navigation ("Track → Finding…"),
 * where the owner sets phase 'busy' and then navigates — there is never a
 * "found" because we never learn the result.
 */
export function RollingLabelButton({
  phase,
  labels,
  icon,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  phase: AsyncPhase;
  labels: RollingLabels;
  /** The idle icon; the default is the gallery's upload arrow. */
  icon?: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      className="mi mi-roll"
      data-phase={phase}
      aria-busy={phase === 'busy'}
      aria-live="polite"
      {...rest}
    >
      <span className="mi-roll__icon" aria-hidden>
        {phase === 'busy' ? (
          <LoaderCircle size={16} />
        ) : phase === 'success' ? (
          <Check size={16} />
        ) : phase === 'error' ? (
          <OctagonX size={16} />
        ) : (
          icon || <Upload size={16} />
        )}
      </span>
      <span className="mi-roll__window">
        <span className="mi-roll__strip">
          <span>{labels.idle}</span>
          <span>{labels.busy}</span>
          <span>{labels.success}</span>
          <span>{labels.error}</span>
        </span>
      </span>
    </button>
  );
}
