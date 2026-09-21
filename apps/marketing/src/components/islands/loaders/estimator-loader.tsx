'use client';

import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';

// The estimator is the heaviest island on the page (two combo selects,
// four steppers, chips, the parachute) and sits below the fold, so it is
// its own chunk. Server-rendered still, so the form is in the HTML.
const EstimatorClient = dynamic(
  () => import('../estimator-client').then((m) => m.EstimatorClient),
  {
    loading: () => <div className="est__skeleton" aria-hidden />,
  },
);

export function EstimatorLoader(): ReactElement {
  return <EstimatorClient />;
}
