'use client';

import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';
import { nearGate } from '@/lib/near-gate';
import { NearLoader } from './near-loader';

// The tour shell is a platform island: it must never be in first-load JS
// (check-bundle.mjs fails on the marker appearing there), so it is its own
// chunk, server-rendered, fetched only when the section is near.
const PlatformTourClient = dynamic(
  () =>
    nearGate('platform-tour').then(() =>
      import('../platform-tour-client').then((m) => m.PlatformTourClient),
    ),
  { loading: () => <div className="tour__skeleton tour__skeleton--all" aria-hidden /> },
);

export function PlatformTourLoader(): ReactElement {
  return (
    <NearLoader id="platform-tour">
      <PlatformTourClient />
    </NearLoader>
  );
}
