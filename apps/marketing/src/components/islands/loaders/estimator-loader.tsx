'use client';

import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';
import { nearGate } from '@/lib/near-gate';
import { NearLoader } from './near-loader';

// The estimator is the heaviest island on the page (two combo selects,
// four steppers, chips, the parachute) and sits below the fold, so it is
// its own chunk, fetched only when the section is near (see near-gate.ts).
// Server-rendered still, so the form is in the HTML.
const EstimatorClient = dynamic(
  () =>
    nearGate('estimator').then(() => import('../estimator-client').then((m) => m.EstimatorClient)),
  { loading: () => <div className="est__skeleton" aria-hidden /> },
);

export function EstimatorLoader(): ReactElement {
  return (
    <NearLoader id="estimator">
      <EstimatorClient />
    </NearLoader>
  );
}
