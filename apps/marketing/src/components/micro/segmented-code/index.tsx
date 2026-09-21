'use client';

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { OctagonX, ShieldCheck } from 'lucide-react';
import '../micro.css';
import './segmented-code.css';

export type CodeVerdict = { ok: true; detail: string } | { ok: false; detail: string };

/**
 * 10 · Segmented code → link-and-merge. One box per digit (6 for an Indian
 * PIN, 4 for a BD postcode), auto-advance, backspace back a box, paste
 * fills every box. When the code is complete `verify` runs (LOCAL and
 * instant — this is not a request, so no parachute); a served code links
 * the boxes, greens them and merges them into a shield-check with the
 * detail (transit time); an unserved code shakes into the danger tint WITH
 * its icon. Typing again clears the verdict.
 */
export function SegmentedCode({
  length,
  verify,
  okLabel = 'We deliver here',
  label = 'Postal code',
}: {
  length: number;
  verify: (code: string) => CodeVerdict;
  okLabel?: string;
  label?: string;
}): ReactElement {
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length }, () => ''));
  const [verdict, setVerdict] = useState<CodeVerdict | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    setDigits(Array.from({ length }, () => ''));
    setVerdict(null);
  }, [length]);

  useEffect(() => {
    if (digits.every((d) => d !== '')) {
      const v = verify(digits.join(''));
      setVerdict(v);
      setShowDetail(false);
      if (v.ok) {
        const t = window.setTimeout(() => setShowDetail(true), 1500);
        return () => window.clearTimeout(t);
      }
    } else setVerdict(null);
    return undefined;
  }, [digits, verify]);

  const set = (i: number, v: string): void => {
    const d = v.replace(/\D/g, '').slice(-1);
    setDigits((prev) => prev.map((x, k) => (k === i ? d : x)));
    if (d && i < length - 1) refs.current[i + 1]?.focus();
  };
  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>): void => {
    // A digit key is handled HERE, not in onChange: typing the digit a box
    // already holds fires no change event, so the caret would never
    // advance — the same-digit case a real PIN (560001) hits at once.
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      set(i, e.key);
      return;
    }
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      e.preventDefault();
      setDigits((prev) => prev.map((x, k) => (k === i - 1 ? '' : x)));
      refs.current[i - 1]?.focus();
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!text) return;
    e.preventDefault();
    setDigits(Array.from({ length }, (_, k) => text[k] ?? ''));
    refs.current[Math.min(text.length, length - 1)]?.focus();
  };

  const state = verdict === null ? 'idle' : verdict.ok ? 'ok' : 'no';
  // Boxes merge toward the centre; each carries its own x offset.
  const mid = (length - 1) / 2;
  return (
    <div className="mi mi-seg" data-verdict={state} role="group" aria-label={label}>
      <div className="mi-seg__row">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="mi-seg__box"
            style={{ '--mx': `${((mid - i) * 3.25).toFixed(2)}rem` } as CSSProperties}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={d}
            aria-label={`${label} digit ${i + 1} of ${length}`}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => onKey(i, e)}
            onPaste={onPaste}
            onFocus={(e) => e.target.select()}
          />
        ))}
        {digits.slice(1).map((_, i) => (
          <span
            key={i}
            className="mi-seg__link"
            aria-hidden
            style={{ '--i': i, left: `${((i + 1) * 3.25 - 0.5).toFixed(2)}rem` } as CSSProperties}
          />
        ))}
        <span className="mi-seg__shield" aria-hidden>
          <ShieldCheck size={26} />
          {okLabel}
        </span>
      </div>
      <p className="mi-seg__verdict" role="status" data-show={showDetail}>
        {state === 'no' && verdict ? (
          <>
            <OctagonX size={16} aria-hidden="true" />
            {verdict.detail}
          </>
        ) : null}
        {state === 'ok' && verdict ? verdict.detail : null}
      </p>
    </div>
  );
}
