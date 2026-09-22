'use client';

import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';
import type { TrackBandClient as TrackBandClientType } from '../track-band-client';
import { nearGate } from '@/lib/near-gate';
import { NearLoader } from './near-loader';

// Below the fold: server-rendered as before, its chunk fetched and its subtree
// hydrated only when the section is near (see near-gate.ts). `loading` is
// LOAD-BEARING — without it next/dynamic gives an SSR'd component no Suspense
// boundary and the pending gate suspends the whole page (contact-loader.tsx).
const TrackBandClient = dynamic(
  () =>
    nearGate('track-band').then(() =>
      import('../track-band-client').then((m) => m.TrackBandClient),
    ),
  { loading: () => null },
);

export function TrackBandLoader(props: Parameters<typeof TrackBandClientType>[0]): ReactElement {
  return (
    <NearLoader id="track-band">
      <TrackBandClient {...props} />
    </NearLoader>
  );
}
