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

  // The log is a terminal — deliberately dark in BOTH themes, so its
  // colors are pinned to the NIGHT OPS palette rather than tokens.
  return (
    <div
      className="rounded-xl p-4 font-mono text-xs leading-7"
      style={{ background: '#060B16', border: '1px solid rgba(148,178,255,0.14)' }}
      role="log"
      aria-label="Example call-confirmation outcomes"
    >
      {rows.map((l, i) => (
        <div key={`${head}-${i}`} className="flex items-center justify-between gap-3">
          <span className="truncate" style={{ color: '#8296AE' }}>
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
              color: l.tone === 'green' ? '#34D399' : l.tone === 'saffron' ? '#F59E0B' : '#38BDF8',
            }}
          >
            {l.outcome}
          </span>
        </div>
      ))}
    </div>
  );
}
