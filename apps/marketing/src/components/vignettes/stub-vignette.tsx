'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Check } from 'lucide-react';
import { useBeats } from './use-beats';
import { VignetteFrame } from './vignette-frame';

const BEATS = [
  {
    id: 'route',
    ms: 1800,
    caption: 'You choose the route: straight to India, or via our Bangladesh warehouse.',
  },
  {
    id: 'count',
    ms: 1800,
    caption:
      'We count what arrives. A difference is a number, never a block — your stock is what was counted.',
  },
  {
    id: 'bill',
    ms: 1800,
    caption: 'Freight is billed the way you agreed: before it flies, on arrival, or as it sells.',
  },
] as const;

const CHECKLIST = [
  'Two routes into India',
  'Counted on arrival, nothing blocked',
  'Three ways to pay the freight',
];

/**
 * 12 · Feature vignette — the STUB that proves the frame: three beats,
 * captions read aloud, ≥44 px pause/play, a checklist beside the mock
 * whose current line follows the beat (`aria-current`), and under reduced
 * motion the mock jumps to each beat's FINAL frame while the captions
 * still advance (the story is the content; only the tween is removed).
 * The six real vignettes in Phase 5 are this shape with real mocks.
 */
export function StubVignette(): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => setNear(es.some((e) => e.isIntersecting)), {
      rootMargin: '200px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const beats = useBeats({ beats: BEATS, enabled: near });
  const i = beats.index;
  return (
    <div ref={ref} className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {CHECKLIST.map((line, k) => (
          <li
            key={line}
            aria-current={k === i ? 'step' : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-md border px-3 text-[15px] transition-colors ${k === i ? 'border-teal-line bg-teal-tint text-teal-on-tint' : 'border-line text-fg-body'}`}
          >
            <span
              className={`inline-grid h-6 w-6 place-items-center rounded-full ${k <= i ? 'bg-teal-fill text-teal-on-fill' : 'bg-surface-3 text-fg-faint'}`}
            >
              {k < i ? <Check size={14} aria-hidden="true" /> : k + 1}
            </span>
            {line}
          </li>
        ))}
      </ol>
      <VignetteFrame beats={beats} title="Get your stock into India" hue="teal">
        {/* The mock — three states of one picture; reduced motion jumps, otherwise it tweens. */}
        <div
          className="absolute inset-0 grid place-items-center p-6"
          data-reduced={beats.reducedMotion}
        >
          <div className="relative flex w-full max-w-sm items-center justify-between">
            {['Dhaka', 'In the air', 'India'].map((stop, k) => (
              <div
                key={stop}
                className="flex flex-col items-center gap-2 text-[12px] font-semibold text-fg-body"
              >
                <span
                  className={`inline-grid h-10 w-10 place-items-center rounded-full border-2 transition-colors ${k <= i ? 'border-teal-fill bg-teal-fill text-teal-on-fill' : 'border-line bg-surface-2 text-fg-faint'}`}
                  style={{ transitionDuration: beats.reducedMotion ? '0ms' : undefined }}
                >
                  {k + 1}
                </span>
                {stop}
              </div>
            ))}
            <span className="absolute left-5 right-5 top-5 -z-10 h-0.5 bg-line" aria-hidden />
            <span
              className="absolute left-5 top-5 -z-10 h-0.5 origin-left bg-teal-fill"
              aria-hidden
              style={{
                right: '1.25rem',
                transform: `scaleX(${i / 2})`,
                transition: beats.reducedMotion
                  ? 'none'
                  : 'transform 1.2s cubic-bezier(0.3,0.6,0.3,1)',
              }}
            />
          </div>
          <div className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] text-fg-body">
            {i === 0
              ? 'Route: via our Bangladesh warehouse'
              : i === 1
                ? 'Counted in Bangladesh · 40 declared · 40 counted'
                : 'Freight billed · Pay before it flies · ৳6,200'}
          </div>
        </div>
      </VignetteFrame>
    </div>
  );
}
