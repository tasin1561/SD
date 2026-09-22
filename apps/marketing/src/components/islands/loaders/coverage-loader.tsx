'use client';

import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';
import type { CoverageClient as CoverageClientType } from '../coverage-client';
import { nearGate } from '@/lib/near-gate';
import { NearLoader } from './near-loader';

// Below the fold: server-rendered as before, its chunk fetched and its subtree
// hydrated only when the section is near (see near-gate.ts). `loading` is
// LOAD-BEARING — without it next/dynamic gives an SSR'd component no Suspense
// boundary and the pending gate suspends the whole page (contact-loader.tsx).
const CoverageClient = dynamic(
  () => nearGate('coverage').then(() => import('../coverage-client').then((m) => m.CoverageClient)),
  { loading: () => null },
);

export function CoverageLoader(props: Parameters<typeof CoverageClientType>[0]): ReactElement {
  return (
    <NearLoader id="coverage">
      <CoverageClient {...props} />
    </NearLoader>
  );
}
