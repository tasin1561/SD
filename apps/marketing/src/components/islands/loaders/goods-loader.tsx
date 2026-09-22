'use client';

import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';
import type { GoodsClient as GoodsClientType } from '../goods-client';
import { nearGate } from '@/lib/near-gate';
import { NearLoader } from './near-loader';

// Below the fold: server-rendered as before, its chunk fetched and its subtree
// hydrated only when the section is near (see near-gate.ts). `loading` is
// LOAD-BEARING — without it next/dynamic gives an SSR'd component no Suspense
// boundary and the pending gate suspends the whole page (contact-loader.tsx).
const GoodsClient = dynamic(
  () => nearGate('goods').then(() => import('../goods-client').then((m) => m.GoodsClient)),
  { loading: () => null },
);

export function GoodsLoader(props: Parameters<typeof GoodsClientType>[0]): ReactElement {
  return (
    <NearLoader id="goods">
      <GoodsClient {...props} />
    </NearLoader>
  );
}
