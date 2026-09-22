'use client';

import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';
import type { HowItWorksClient as HowItWorksClientType } from '../how-it-works-client';
import { nearGate } from '@/lib/near-gate';
import { NearLoader } from './near-loader';

// Below the fold: server-rendered as before, its chunk fetched and its subtree
// hydrated only when the section is near (see near-gate.ts). `loading` is
// LOAD-BEARING — without it next/dynamic gives an SSR'd component no Suspense
// boundary and the pending gate suspends the whole page (contact-loader.tsx).
const HowItWorksClient = dynamic(
  () =>
    nearGate('how-it-works').then(() =>
      import('../how-it-works-client').then((m) => m.HowItWorksClient),
    ),
  { loading: () => null },
);

export function HowItWorksLoader(props: Parameters<typeof HowItWorksClientType>[0]): ReactElement {
  return (
    <NearLoader id="how-it-works">
      <HowItWorksClient {...props} />
    </NearLoader>
  );
}
