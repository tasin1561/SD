'use client';

import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';
import { nearGate } from '@/lib/near-gate';
import { NearLoader } from './near-loader';

// The contact form sits at the bottom of the page: server-rendered (its
// mailto / WhatsApp links work before any script), hydrated only when the
// section is near (see near-gate.ts), so the first-load figure does not
// move for a form most visitors never reach.
//
// `loading` is LOAD-BEARING, not cosmetic: next/dynamic only wraps an SSR'd
// component in a Suspense boundary when a loading component is given
// (`hasSuspenseBoundary = !ssr || !!loading`). Without one, the near-gate's
// pending promise suspends the PAGE SEGMENT and nothing on the page ever
// hydrates — no error anywhere, the theme toggle and hero tabs simply never
// appear. Found by `theme.spec.ts` and `hero-fit.spec.ts` going red together.
const ContactClient = dynamic(
  () => nearGate('contact').then(() => import('../contact-client').then((m) => m.ContactClient)),
  { loading: () => <div className="ct__skeleton" aria-hidden /> },
);

export function ContactLoader(props: { toEmail: string; whatsappHref: string }): ReactElement {
  return (
    <NearLoader id="contact">
      <ContactClient {...props} />
    </NearLoader>
  );
}
