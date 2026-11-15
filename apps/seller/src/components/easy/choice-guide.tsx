'use client';

import { Check, ChevronDown, CircleHelp } from 'lucide-react';
import { useId, useState, type ReactElement } from 'react';
import { useT } from '@/i18n/client';
import './easy.css';

export interface GuideChoice<V extends string> {
  readonly value: V;
  /** The option's name, exactly as the dropdown shows it. */
  readonly label: string;
  /** What choosing it does, in plain words. */
  readonly helper: string;
}

/**
 * "What does each choice do?" — the instruction menu beside a dropdown
 * whose options have consequences (a call outcome, a condition, a
 * decision).
 *
 * A dropdown shows names only, and the explanation of one option appears
 * only AFTER it is picked — so the way to learn the options was to pick
 * each in turn. This lists every option with what it does, side by side,
 * before anything is chosen.
 *
 * It opens in place, under its button (no second window, so it also works
 * inside a dialog). With `onChoose`, pressing an option picks it in the
 * dropdown and closes the guide; without it the guide is reading only.
 * The dropdown stays — this adds to it and never replaces it.
 */
export function ChoiceGuide<V extends string>({
  choices,
  selected,
  onChoose,
  disabled = false,
  label,
}: {
  readonly choices: ReadonlyArray<GuideChoice<V>>;
  /** The value chosen now, to mark it in the list. */
  readonly selected?: V | '' | undefined;
  readonly onChoose?: ((value: V) => void) | undefined;
  /** Reading still works; choosing does not (the dropdown is held too). */
  readonly disabled?: boolean;
  /** Overrides the button's words. */
  readonly label?: string | undefined;
}): ReactElement | null {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  if (choices.length === 0) return null;
  const pickable = onChoose !== undefined && !disabled;

  return (
    <div className="ez-guide" data-open={open || undefined}>
      <button
        type="button"
        className="ez-guide__trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <CircleHelp size={16} aria-hidden />
        <span>{label ?? t('easy.guideTrigger')}</span>
        <ChevronDown size={16} className="ez-guide__chev" aria-hidden />
      </button>
      {open && (
        <ul id={id} className="ez-guide__list">
          {choices.map((c) => {
            const chosen = c.value === selected;
            const body = (
              <>
                <span className="ez-guide__name">
                  {c.label}
                  {chosen && (
                    <span className="ez-guide__chosen">
                      <Check size={13} strokeWidth={3} aria-hidden />
                      {t('easy.guideChosen')}
                    </span>
                  )}
                </span>
                <span className="ez-guide__what">{c.helper}</span>
              </>
            );
            return (
              <li key={c.value} className="ez-guide__item" data-chosen={chosen || undefined}>
                {pickable ? (
                  <button
                    type="button"
                    className="ez-guide__pick"
                    aria-pressed={chosen}
                    onClick={() => {
                      onChoose(c.value);
                      setOpen(false);
                    }}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="ez-guide__pick">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
