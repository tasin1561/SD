import { Check } from 'lucide-react';
import type { ReactElement } from 'react';
import type { TourChecklistItem, TourHue } from '@/content/sections/tour-types';
import './vignette-checklist.css';

/**
 * The checklist beside every vignette's mock (u03 spirit): the 3A bullets
 * as real text, the CURRENT line tinted in the tour hue and marked
 * `aria-current="step"`, earlier lines ticked. Nothing here is conveyed by
 * the picture alone — this is the accessible half of the vignette.
 */
export function VignetteChecklist({
  items,
  currentBeat,
  beatOrder,
  hue,
}: {
  items: readonly TourChecklistItem[];
  currentBeat: string | undefined;
  beatOrder: readonly string[];
  hue: TourHue;
}): ReactElement {
  const cur = currentBeat ? beatOrder.indexOf(currentBeat) : -1;
  return (
    <ol className="vchk" data-hue={hue}>
      {items.map((it, k) => {
        const at = beatOrder.indexOf(it.beat);
        const state = at < cur ? 'done' : at === cur ? 'current' : 'todo';
        return (
          <li
            key={it.id}
            className="vchk__item"
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="vchk__n" aria-hidden>
              {state === 'done' ? <Check size={14} strokeWidth={3} /> : k + 1}
            </span>
            <span>{it.text}</span>
          </li>
        );
      })}
    </ol>
  );
}
