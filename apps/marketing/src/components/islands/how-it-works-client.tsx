'use client';

import type { ReactElement, ReactNode } from 'react';
import { ProgressStepper } from '@/components/micro/progress-stepper';

interface StepContent {
  id: string;
  title: string;
  body: string;
  runs: readonly string[];
  icon: number;
}

export function HowItWorksClient({
  steps,
  icons,
}: {
  steps: readonly StepContent[];
  icons: readonly ReactNode[];
}): ReactElement {
  return (
    <ProgressStepper
      label="How it works"
      steps={steps.map((s) => ({
        id: s.id,
        title: s.title,
        icon: icons[s.icon],
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
  );
}
