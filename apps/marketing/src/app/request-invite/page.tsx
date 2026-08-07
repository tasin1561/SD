import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { Nav } from '@/components/landing/nav';
import { SiteFooter } from '@/components/landing/site-footer';
import { CorridorConsole } from '@/components/landing/corridor-console';
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
 *
 * ── The backdrop ─────────────────────────────────────────────────────
 * The same staging as the sign-in consoles: the live corridor behind a
 * vignette, the grid, and one glow above the panel. It started as a flat
 * card on near-black, which read as a form bolted onto the site rather
 * than part of it — and this page is where someone decides whether we
 * look like an operation worth handing their stock to.
 *
 * The corridor sits at low opacity behind a radial that darkens the
 * middle, so the form stays the brightest thing on screen. Atmosphere
 * competing with the fields would be atmosphere working against the one
 * thing the page is for.
 */
export default function RequestInvitePage(): ReactElement {
  return (
    <>
      <Nav />
      {/* `pt-12`, not `pt-28`. The 112px was written for a nav that
          overlays the page and has to be cleared — this one sits in
          normal flow, so main already starts below it and every pixel
          of that padding was surplus. It pushed the wordmark 177px down
          a page whose whole job is the form underneath it. */}
      <main id="main" className="bg-surface relative min-h-screen overflow-hidden pt-12 pb-24">
        <div aria-hidden className="console-grid absolute inset-0" />

        {/* The live corridor, well back. Decorative only — it carries no
            information the form needs, so it is hidden from assistive
            tech and never intercepts a pointer. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.28]">
          <CorridorConsole />
        </div>

        {/* Darkens the centre so the panel reads first. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(closest-side at 50% 42%, var(--surface) 30%, transparent 100%)',
            opacity: 0.88,
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 h-[460px] w-[720px] -translate-x-1/2 rounded-full"
          style={{
            // Phosphor bloom removed — a saturated halo is the neon-on-dark
            // treatment this pass drops. The surface step and the
            // border carry the emphasis instead.
            background: 'none',
            opacity: 0.5,
          }}
        />

        <div className="relative mx-auto max-w-3xl px-5 sm:px-8">
          <InviteForm />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
