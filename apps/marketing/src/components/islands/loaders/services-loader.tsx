'use client';

import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';
import type { ServicesClient as ServicesClientType } from '../services-client';
import { nearGate } from '@/lib/near-gate';
import { NearLoader } from './near-loader';

// Below the fold: server-rendered as before, its chunk fetched and its subtree
// hydrated only when the section is near (see near-gate.ts). `loading` is
// LOAD-BEARING — without it next/dynamic gives an SSR'd component no Suspense
// boundary and the pending gate suspends the whole page (contact-loader.tsx).
const ServicesClient = dynamic(
  () => nearGate('services').then(() => import('../services-client').then((m) => m.ServicesClient)),
  { loading: () => null },
);

export function ServicesLoader(props: Parameters<typeof ServicesClientType>[0]): ReactElement {
  return (
    <NearLoader id="services">
      <ServicesClient {...props} />
    </NearLoader>
  );
}
