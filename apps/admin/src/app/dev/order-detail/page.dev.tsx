'use client';

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { AuthProvider } from '@skydrop/auth/client';
import { Toaster } from '@skydrop/ui/components';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { LocaleProvider } from '@skydrop/ui/app/i18n-client';
import type { Locale } from '@skydrop/ui/app/i18n';
import type { StaffMe } from '@skydrop/api-client';
import { QueryProvider } from '@/components/query-provider';
import { OrderDetailView } from '../../(authed)/orders/_components/order-detail';
import { DEV_ORDER_ID, FIXTURE_IDS, fixture, type FixtureId } from './fixtures.dev';
import '@skydrop/ui/brand/scales.css';
import '@skydrop/ui/brand/theme.css';
import '@skydrop/ui/brand/app.css';

/**
 * /dev/order-detail — the REAL redesigned order page against MOCKED API
 * responses, so it can be looked at without a database.
 *
 * DEV ONLY: `page.dev.tsx` compiles only when APPS_DEV_ROUTES=1 (see
 * next.config.mjs), so it cannot reach a production chunk.
 *
 *   ?fixture=a..f   a in-transit prepaid order with address issues
 *                   b COD, no shipment yet     c RTO
 *                   d two shipments            e very long name/address
 *                   f no override, no courier-write permission
 *   ?locale=en|bn|hi   ?theme=light|dark
 *
 * Only `fetch` is faked: every component, hook and request below is the
 * real one. A mutation answers 200 with an empty body, so a dialog can be
 * driven to its end without touching anything.
 */
let current: FixtureId = 'a';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetch(): void {
  const w = window as unknown as { __odFetch?: boolean };
  if (w.__odFetch === true) return;
  w.__odFetch = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      window.location.origin,
    );
    const path = url.pathname;
    const base = `/api/admin/orders/${DEV_ORDER_ID}`;
    if (!path.startsWith('/api/')) return real(input, init);
    const f = fixture(current);
    const method = (init?.method ?? 'GET').toUpperCase();
    // What the page SENT, for the keyboard pass to inspect (the typed
    // confirmation must never appear in a request body).
    const calls = ((window as unknown as { __odCalls?: unknown[] }).__odCalls ??= []);
    if (method !== 'GET') calls.push({ method, path, body: init?.body ?? null });
    await new Promise((r) => setTimeout(r, 60));
    if (method !== 'GET') {
      if (path.endsWith('release-reservations')) {
        return json({
          releasedCount: 1,
          released: [{ reservationId: 'r1abcdef12', qtyReleased: 1, alreadyInactive: false }],
        });
      }
      if (path.endsWith('restore-reservations')) {
        return json({ reservedCount: 1, shortfall: null, orderNumber: 'SD-2026-26-000065' });
      }
      return json({});
    }
    if (path === base) return json(f.order);
    if (path === `${base}/shipments`) return json(f.shipments);
    if (path === `${base}/journey`) return json(f.journey);
    if (path === `${base}/address-check`) {
      return f.check === null ? json({ code: 'NOT_FOUND', message: 'none' }, 404) : json(f.check);
    }
    if (path === `${base}/consignee`) {
      return 'error' in f.consignee
        ? json({ code: f.consignee.error, message: f.consignee.error }, 409)
        : json(f.consignee);
    }
    if (path === `${base}/consignee/history`) return json([]);
    if (path === `${base}/charges`) return json(f.charges);
    if (path === `${base}/parcel-activity`) return json(f.audit);
    if (path === `${base}/customer-reputation`) {
      return json({
        phoneE164: '+919883596606',
        platform: {
          totalOrders: 1,
          delivered: 0,
          returned: 0,
          refusedOnCall: 0,
          returnRatePercent: null,
          firstOrderAt: null,
          lastOrderAt: null,
        },
        yours: { totalOrders: 1, delivered: 0, returned: 0, recentOrders: [], openOrders: [] },
        riskLevel: 'NONE',
        riskNotes: null,
        customerName: null,
      });
    }
    return json({ code: 'NOT_MOCKED', message: path }, 404);
  };
}

/** The console's 248px rail from 1024px up, so widths match the real app. */
const RAIL_CSS =
  '.odh-shell{display:flex}.odh-rail{display:none}@media(min-width:1024px){.odh-rail{display:block;flex:none;width:248px;background:var(--surface);border-right:1px solid var(--line)}}';

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
const TOP: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 30,
  height: 56,
  background: 'var(--surface)',
  borderBottom: '1px solid var(--line)',
};

export default function OrderDetailHarness(): ReactElement {
  const [fixtureId, setFixtureId] = useState<FixtureId>('a');
  const [locale, setLocale] = useState<Locale>('en');
  const [theme, setTheme] = useState<Theme>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const f = p.get('fixture');
    const l = p.get('locale');
    const th = p.get('theme');
    if (FIXTURE_IDS.some((x) => x === f)) setFixtureId(f as FixtureId);
    if (LOCALES.some((x) => x === l)) setLocale(l as Locale);
    if (th === 'light' || th === 'dark') setTheme(th);
    setReady(true);
  }, []);

  // Set DURING render, not in an effect: the children's queries fire in
  // THEIR effects, which run before this component's, and would otherwise
  // read the previous fixture.
  current = fixtureId;

  useEffect(() => {
    installFetch();
    document.documentElement.dataset['theme'] = theme;
    const p = new URLSearchParams(window.location.search);
    p.set('fixture', fixtureId);
    p.set('locale', locale);
    p.set('theme', theme);
    window.history.replaceState(null, '', `?${p.toString()}`);
  }, [fixtureId, locale, theme]);

  const identity = {
    id: 'staff-dev',
    email: 'dev@skydrop.global',
    emailDisplay: 'dev@skydrop.global',
    permissions: fixture(fixtureId).permissions,
  } as unknown as StaffMe;

  return (
    <div
      style={{ '--top-h': '56px', minHeight: '100vh', background: 'var(--page)' } as CSSProperties}
    >
      <div style={TOP}>
        <div style={BAR}>
          {FIXTURE_IDS.map((id) => (
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
      </div>
      <style>{RAIL_CSS}</style>
      {ready ? (
        <div className="odh-shell">
          <div className="odh-rail" />
          <main style={{ padding: 24, flex: 1, minWidth: 0 }}>
            <LocaleProvider key={`${fixtureId}-${locale}`} initialLocale={locale}>
              <QueryProvider key={`${fixtureId}-${locale}`}>
                <AuthProvider<StaffMe> identityKind="staff" initialIdentity={identity}>
                  <Toaster>
                    <ToastProvider>
                      <OrderDetailView orderId={DEV_ORDER_ID} />
                    </ToastProvider>
                  </Toaster>
                </AuthProvider>
              </QueryProvider>
            </LocaleProvider>
          </main>
        </div>
      ) : null}
    </div>
  );
}
