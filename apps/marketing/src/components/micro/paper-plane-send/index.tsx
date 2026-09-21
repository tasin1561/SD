'use client';

import type { ReactElement, ReactNode } from 'react';
import { Check, Send } from 'lucide-react';
import type { AsyncPhase } from '../use-async-state';
import '../micro.css';
import './paper-plane-send.css';

/**
 * 3 · Paper-plane send. Muted until the field is `valid`, then filled; on
 * submit the button folds into a plane and flies off; the owner of `phase`
 * decides when "Done" is true. Lives in the gallery only until the
 * newsletter has an endpoint (`features.newsletter`).
 */
export function PaperPlaneSend({
  phase,
  valid,
  label = 'Subscribe',
  doneLabel = 'Done',
}: {
  phase: AsyncPhase;
  valid: boolean;
  label?: ReactNode;
  doneLabel?: ReactNode;
}): ReactElement {
  return (
    <span
      className="mi mi-plane"
      data-phase={phase}
      data-valid={valid}
      aria-busy={phase === 'busy'}
    >
      <button type="submit" className="mi-plane__btn" disabled={!valid || phase !== 'idle'}>
        {label}
      </button>
      <span className="mi-plane__plane" aria-hidden>
        <Send size={28} />
      </span>
      <span className="mi-plane__done" role="status">
        {phase === 'success' ? (
          <>
            <Check size={16} aria-hidden="true" />
            {doneLabel}
          </>
        ) : null}
      </span>
    </span>
  );
}
