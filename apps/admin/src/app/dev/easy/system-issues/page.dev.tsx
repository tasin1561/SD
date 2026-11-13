'use client';

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { AuthProvider } from '@skydrop/auth/client';
import { Toaster } from '@skydrop/ui/components';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { LocaleProvider } from '@skydrop/ui/app/i18n-client';
import type { Locale } from '@skydrop/ui/app/i18n';
import type { StaffMe } from '@skydrop/api-client';
import { QueryProvider } from '@/components/query-provider';
import { SystemIssuesIndex } from '../../../(authed)/system-issues/_components/system-issues-index';
import '@skydrop/ui/brand/scales.css';
import '@skydrop/ui/brand/theme.css';
import '@skydrop/ui/brand/app.css';

/**
 * /dev/easy/system-issues — the REAL "Needs a person" page against MOCKED
 * API responses, so it can be looked at without a database.
 *
 * DEV ONLY: `page.dev.tsx` compiles only when APPS_DEV_ROUTES=1 (see
 * next.config.mjs), so it cannot reach a production chunk.
 *
 *   ?fixture=a  a mixed queue (critical with an order, high being looked at,
 *               medium seen many times, low, a pickup issue, one closed)
 *            b  nothing open          c  the list fails to load
 *            d  a viewer: may not close issues or open pickups
 *            e  very long title and detail, one issue
 *   ?locale=en|bn|hi   ?theme=light|dark
 *
 * Only `fetch` is faked. A mutation answers 200, so a dialog can be driven
 * to its end without touching anything.
 */
const FIXTURES = ['a', 'b', 'c', 'd', 'e'] as const;
type FixtureId = (typeof FIXTURES)[number];
let current: FixtureId = 'a';

const ago = (mins: number): string => new Date(Date.now() - mins * 60_000).toISOString();

function issues(includeResolved: boolean): unknown[] {
  const open = [
    {
      id: 'i1',
      kind: 'COURIER_BOOKING_FAILED',
      severity: 'CRITICAL',
      title: 'Delhivery refused a parcel and no backup courier took it',
      detail:
        'Order SD-2026-26-000071 could not be booked: the pincode is not serviceable.\nOpen the order and place it by hand with another courier.',
      source: 'shipment-provision.book',
      occurrenceCount: 1,
      firstSeenAt: ago(12),
      lastSeenAt: ago(12),
      acknowledgedAt: null,
      resolvedAt: null,
      resolutionNote: null,
      metadata: { orderId: '01a1cf45-6d0b-73cf-8f7e-ff51baf525e6' },
    },
    {
      id: 'i2',
      kind: 'COURIER_PORTAL_LOGIN',
      severity: 'HIGH',
      title: 'Shiprocket portal is asking for a one-time code',
      detail:
        'The nightly cost sync cannot log in until somebody enters the code sent to the account phone.',
      source: 'courier-portal.shiprocket',
      occurrenceCount: 4,
      firstSeenAt: ago(60 * 9),
      lastSeenAt: ago(35),
      acknowledgedAt: ago(60 * 2),
      resolvedAt: null,
      resolutionNote: null,
      metadata: null,
    },
    {
      id: 'i3',
      kind: 'AUTO_PICKUP_FAILED',
      severity: 'MEDIUM',
      title: 'No van was asked for today’s boxes at Kolkata',
      detail:
        'The automatic pickup request for Delhivery failed. A failed day is not retried by itself.',
      source: 'courier-pickup.auto',
      occurrenceCount: 2,
      firstSeenAt: ago(60 * 26),
      lastSeenAt: ago(60 * 3),
      acknowledgedAt: null,
      resolvedAt: null,
      resolutionNote: null,
      metadata: null,
    },
    {
      id: 'i4',
      kind: 'EMAIL_BOUNCE',
      severity: 'LOW',
      title: 'A daily summary email bounced',
      detail: 'The address ops@example.test rejected the message.',
      source: 'notifications.email',
      occurrenceCount: 1,
      firstSeenAt: ago(60 * 24 * 4),
      lastSeenAt: ago(60 * 24 * 4),
      acknowledgedAt: null,
      resolvedAt: null,
      resolutionNote: null,
      metadata: null,
    },
  ];
  const closed = {
    id: 'i5',
    kind: 'TRACKING_STALE',
    severity: 'HIGH',
    title: 'Tracking stopped updating',
    detail: 'No courier scan was read for 50 minutes.',
    source: 'tracking.poller',
    occurrenceCount: 3,
    firstSeenAt: ago(60 * 30),
    lastSeenAt: ago(60 * 28),
    acknowledgedAt: ago(60 * 29),
    resolvedAt: ago(60 * 27),
    resolutionNote: 'Restarted the poller',
    metadata: null,
  };
  if (current === 'b') return includeResolved ? [closed] : [];
  if (current === 'e') {
    return [
      {
        ...open[0],
        title:
          'Delhivery refused a parcel and no backup courier took it and this title is deliberately very long to see how it wraps on a small phone screen',
        detail: `${'A very long explanation that keeps going so wrapping can be checked. '.repeat(8)}\nSecond line with an unbreakable token: ${'X'.repeat(90)}`,
        source: 'a.very.long.source.identifier.that.should.wrap.inside.the.bubble.and.not.overflow',
        occurrenceCount: 128,
      },
    ];
  }
  return includeResolved ? [...open, closed] : open;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetch(): void {
  const w = window as unknown as { __ezFetch?: boolean; __ezCalls?: unknown[] };
  if (w.__ezFetch === true) return;
  w.__ezFetch = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      window.location.origin,
    );
    const path = url.pathname;
    if (!path.startsWith('/api/')) return real(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const calls = (w.__ezCalls ??= []);
    if (method !== 'GET') calls.push({ method, path, body: init?.body ?? null });
    await new Promise((r) => setTimeout(r, 80));
    if (path === '/api/admin/system-issues') {
      if (current === 'c') {
        return json(
          { code: 'SERVICE_UNAVAILABLE', message: 'The issue list is not reachable' },
          503,
        );
      }
      return json(issues(url.searchParams.get('includeResolved') === 'true'));
    }
    if (path.endsWith('/announce-unnotified')) {
      return json({ open: 4, announced: 2, alreadyAnnounced: 2 });
    }
    if (path.endsWith('/acknowledge')) return json({ acknowledgedAt: new Date().toISOString() });
    if (path.endsWith('/resolve')) return json({ resolvedAt: new Date().toISOString() });
    return json({ code: 'NOT_MOCKED', message: path }, 404);
  };
}

const LOCALES: readonly Locale[] = ['en', 'bn', 'hi'];
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

const BAR: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  padding: 8,
  background: 'var(--surface-3)',
  color: 'var(--fg-body)',
};

export default function SystemIssuesHarness(): ReactElement {
  const [fixtureId, setFixtureId] = useState<FixtureId>('a');
  const [locale, setLocale] = useState<Locale>('en');
  const [theme, setTheme] = useState<Theme>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const f = p.get('fixture');
    const l = p.get('locale');
    const th = p.get('theme');
    if (FIXTURES.some((x) => x === f)) setFixtureId(f as FixtureId);
    if (LOCALES.some((x) => x === l)) setLocale(l as Locale);
    if (th === 'light' || th === 'dark') setTheme(th);
    installFetch();
    setReady(true);
  }, []);

  // Set DURING render: the children's queries fire in their effects, which
  // run before this component's, and would otherwise read the old fixture.
  current = fixtureId;

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  const identity = {
    id: 'staff-dev',
    email: 'dev@skydrop.global',
    emailDisplay: 'dev@skydrop.global',
    permissions:
      fixtureId === 'd'
        ? ['system.settings.view']
        : ['system.settings.view', 'system.settings.manage', 'courier.pickups.manage'],
  } as unknown as StaffMe;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page)' }}>
      <div style={BAR} data-dev-bar>
        {FIXTURES.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={id === fixtureId}
            onClick={() => setFixtureId(id)}
          >
            {id}
          </button>
        ))}
        {LOCALES.map((l) => (
          <button key={l} type="button" aria-pressed={l === locale} onClick={() => setLocale(l)}>
            {l}
          </button>
        ))}
        {THEMES.map((th) => (
          <button key={th} type="button" aria-pressed={th === theme} onClick={() => setTheme(th)}>
            {th}
          </button>
        ))}
      </div>
      {ready && (
        <QueryProvider key={fixtureId}>
          <AuthProvider<StaffMe> identityKind="staff" initialIdentity={identity}>
            <LocaleProvider initialLocale={locale} key={locale}>
              <Toaster>
                <ToastProvider>
                  <main
                    style={{ maxWidth: 1180, margin: '0 auto', padding: 'clamp(12px, 3vw, 32px)' }}
                  >
                    <SystemIssuesIndex />
                  </main>
                </ToastProvider>
              </Toaster>
            </LocaleProvider>
          </AuthProvider>
        </QueryProvider>
      )}
    </div>
  );
}
