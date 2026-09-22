'use client';

import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';
import type { TestimonialsClient as TestimonialsClientType } from '../testimonials-client';
import { nearGate } from '@/lib/near-gate';
import { NearLoader } from './near-loader';

// Below the fold: server-rendered as before, its chunk fetched and its subtree
// hydrated only when the section is near (see near-gate.ts). `loading` is
// LOAD-BEARING — without it next/dynamic gives an SSR'd component no Suspense
// boundary and the pending gate suspends the whole page (contact-loader.tsx).
const TestimonialsClient = dynamic(
  () =>
    nearGate('testimonials').then(() =>
      import('../testimonials-client').then((m) => m.TestimonialsClient),
    ),
  { loading: () => null },
);

export function TestimonialsLoader(
  props: Parameters<typeof TestimonialsClientType>[0],
): ReactElement {
  return (
    <NearLoader id="testimonials">
      <TestimonialsClient {...props} />
    </NearLoader>
  );
}
