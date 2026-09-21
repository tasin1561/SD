'use client';

import type { ReactElement, ReactNode } from 'react';
import { Check, OctagonX, Package } from 'lucide-react';
import type { AsyncPhase } from '../use-async-state';
import '../micro.css';
import './van-drive-off.css';

export interface VanSubmitButtonProps {
  phase: AsyncPhase;
  label: ReactNode;
  successLabel: ReactNode;
  errorLabel: ReactNode;
  disabled?: boolean;
}

/**
 * 2 · Van drive-off — a submit button whose PHASE the form owns (through
 * `useAsyncState`), so the drive-off can never play before the server has
 * answered. Idle → busy: the label rises out and a parcel drops in. Busy →
 * success: the pill shrinks into a van that drives off right, revealing the
 * success pill. Error: the pill is replaced by the danger verdict at once.
 */
export function VanSubmitButton({
  phase,
  label,
  successLabel,
  errorLabel,
  disabled,
}: VanSubmitButtonProps): ReactElement {
  return (
    <span className="mi mi-van" data-phase={phase} aria-busy={phase === 'busy'}>
      <button type="submit" className="mi-van__btn" disabled={disabled || phase !== 'idle'}>
        <span className="mi-van__label">{label}</span>
        <span className="mi-van__parcel" aria-hidden>
          <Package size={18} />
        </span>
      </button>
      <svg className="mi-van__truck" viewBox="0 0 56 32" aria-hidden>
        <g className="mi-van__lines" stroke="currentColor" strokeWidth="1.5" opacity=".6">
          <path d="M2 14h9M0 19h7M3 24h8" />
        </g>
        <path d="M16 8h22l8 7v9H16z" fill="currentColor" />
        <path d="M38 8l8 7h-8z" fill="var(--blue-200)" />
        <circle cx="24" cy="25" r="4" fill="var(--slate-900)" />
        <circle cx="42" cy="25" r="4" fill="var(--slate-900)" />
      </svg>
      <span className="mi-van__done" role="status">
        {phase === 'success' ? <Check size={16} aria-hidden="true" /> : null}
        {phase === 'error' ? <OctagonX size={16} aria-hidden="true" /> : null}
        {phase === 'success' ? successLabel : null}
        {phase === 'error' ? errorLabel : null}
      </span>
    </span>
  );
}
