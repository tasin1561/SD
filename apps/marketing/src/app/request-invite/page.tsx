import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { Nav } from '@/components/landing/nav';
import { SiteFooter } from '@/components/landing/site-footer';
import { InviteForm } from '@/components/landing/invite-form';

export const metadata: Metadata = {
  title: 'Request an invite · Skydrop',
  description:
    'Skydrop is invite-only while we scale the warehouse. Tell us about your store and we will get back to you within one working day.',
};

/**
 * A page rather than a modal.
 *
 * The site is a static export, so both are equally cheap to build — but
 * a page has a URL, which means the CTA can be shared, linked from a
 * WhatsApp message, and returned to after a browser reload eats a
 * half-filled modal.
 */
export default function RequestInvitePage(): ReactElement {
  return (
    <>
      <Nav />
      <main id="main" className="relative bg-surface min-h-screen pt-28 pb-24">
        <div aria-hidden className="console-grid absolute inset-0 opacity-50" />
        <div className="relative mx-auto max-w-3xl px-5 sm:px-8">
          <InviteForm />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
