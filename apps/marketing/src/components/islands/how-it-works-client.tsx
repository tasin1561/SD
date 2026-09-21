'use client';

import { useState, type ReactElement, type ReactNode } from 'react';
import { LiquidBead } from '@/components/micro/liquid-bead';
import { ProgressStepper } from '@/components/micro/progress-stepper';

interface StepContent {
  id: string;
  title: string;
  body: string;
  runs: readonly string[];
}

export interface Track {
  id: 'parcel' | 'seller';
  label: string;
  hue: string;
  steps: readonly StepContent[];
  icons: readonly ReactNode[];
}

/**
 * Two tracks under a liquid-bead toggle: SENDING A PARCEL (the courier
 * story — default, because this is a courier site first) and SELLING IN
 * INDIA (the seller's four steps). Switching remounts the stepper so it
 * starts at step one.
 */
export function HowItWorksClient({ tracks }: { tracks: readonly Track[] }): ReactElement {
  const [active, setActive] = useState<string>(tracks[0]?.id ?? 'parcel');
  const track = tracks.find((t) => t.id === active) ?? tracks[0];
  if (!track) return <></>;
  return (
    <div className="how">
      <LiquidBead
        label="What are you doing?"
        className="how__tabs"
        value={track.id}
        onChange={setActive}
        tabs={tracks.map((t) => ({ id: t.id, label: t.label, hue: t.hue }))}
      />
      <ProgressStepper
        key={track.id}
        label={`How it works — ${track.label}`}
        steps={track.steps.map((s, i) => ({
          id: s.id,
          title: s.title,
          icon: track.icons[i],
          body: (
            <div className="how__panel sec-card">
              <div>
                <h3 className="how__title">{s.title}</h3>
                <p className="how__body">{s.body}</p>
              </div>
              <ul className="how__runs" aria-label={`What happens in “${s.title}”`}>
                {s.runs.map((r, i) => (
                  <li key={r} className="how__run" style={{ '--i': i } as React.CSSProperties}>
                    <span className="how__run-dot" aria-hidden />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          ),
        }))}
      />
    </div>
  );
}
