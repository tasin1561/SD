'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useReducedMotion } from '@/lib/reveal';

/**
 * Simulated call-confirm log for the signature bento cell. The line
 * vocabulary mirrors the real call-center outcome set (CONFIRMED /
 * NO_ANSWER re-queue / NDR at attempt cap). Lines cycle every ~2.2s;
 * reduced-motion renders the full list statically.
 */

interface Line {
  label: string;
  outcome: string;
  tone: 'green' | 'sky' | 'saffron';
}

const LINES: Line[] = [
  { label: 'attempt 1 · ringing', outcome: 'CONFIRMED', tone: 'green' },
  { label: 'attempt 1 · no answer', outcome: 'RE-QUEUED', tone: 'sky' },
  { label: 'attempt 2 · ringing', outcome: 'CONFIRMED', tone: 'green' },
  { label: 'attempt 1 · busy', outcome: 'RE-QUEUED', tone: 'sky' },
  { label: 'attempt 3 · unreachable', outcome: 'NDR — HELD', tone: 'saffron' },
  { label: 'attempt 1 · ringing', outcome: 'CONFIRMED', tone: 'green' },
];

const VISIBLE = 4;

export function CallLog(): ReactElement {
  const prefersReduced = useReducedMotion();
  const [head, setHead] = useState(VISIBLE);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (prefersReduced) return;
    timer.current = setInterval(() => {
      setHead((h) => h + 1);
    }, 2200);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [prefersReduced]);

  const rows: Line[] = prefersReduced
    ? LINES.slice(0, VISIBLE)
    : Array.from({ length: VISIBLE }, (_, i) => {
        const idx = (head - VISIBLE + i + LINES.length * 100) % LINES.length;
        return LINES[idx] as Line;
      });

  // The log is a TERMINAL, and it stays dark in both themes on purpose:
  // it is showing you a machine's own output rather than a piece of the
  // page, and the reference makes the same move with its console panel
  // on a white ground. That means its colours cannot be tokens — a
  // token resolves to the LIGHT ramp under a light theme and the panel
  // would turn into pale grey text on near-black. They are pinned to
  // the dark theme's own values instead, which is the one place in this
  // app a literal is the correct answer.
  return (
    <div
      className="rounded-md p-4 font-mono text-[12px] leading-7"
      style={{ background: '#070a11', border: '1px solid rgba(180,197,255,0.16)' }}
      role="log"
      aria-label="Example call-confirmation outcomes"
    >
      {rows.map((l, i) => (
        <div key={`${head}-${i}`} className="flex items-center justify-between gap-3">
          <span className="truncate" style={{ color: '#8296b0' }}>
            &gt; {l.label}
          </span>
          {/* The outcome is the point of the row, so it never wraps and
              never shrinks — at 320px it is the label that gives way,
              which is what its `truncate` is for. Without this, "NDR —
              HELD" breaks across two lines and the log stops reading
              like a terminal. */}
          <span
            className="shrink-0 whitespace-nowrap"
            style={{
              color: l.tone === 'green' ? '#34d399' : l.tone === 'saffron' ? '#fbbf24' : '#b4c5ff',
            }}
          >
            {l.outcome}
          </span>
        </div>
      ))}
    </div>
  );
}
