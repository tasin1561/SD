'use client';

import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';
import { nearGate } from '@/lib/near-gate';
import { NearLoader } from './near-loader';

// Section 14's two-party demo is a platform island: `check-bundle.mjs`
// fails if its marker appears in first-load JS, so it is its own chunk,
// server-rendered, fetched only when the section is near (near-gate.ts).
const ResellerStoresClient = dynamic(
  () =>
    nearGate('reseller-stores').then(() =>
      import('../reseller-stores-client').then((m) => m.ResellerStoresClient),
    ),
  { loading: () => <div className="rs__skeleton" aria-hidden /> },
);

export function ResellerStoresLoader(): ReactElement {
  return (
    <NearLoader id="reseller-stores">
      <ResellerStoresClient />
    </NearLoader>
  );
}
