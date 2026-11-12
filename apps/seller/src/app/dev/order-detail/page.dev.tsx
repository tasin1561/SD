'use client';

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { AuthProvider } from '@skydrop/auth/client';
import { MoneyDisplayProvider, Toaster } from '@skydrop/ui/components';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { LocaleProvider } from '@skydrop/ui/app/i18n-client';
import type { Locale } from '@skydrop/ui/app/i18n';
import type { SellerMe } from '@skydrop/api-client';
import { QueryProvider } from '@/components/query-provider';
import { OrderDetailView } from '../../(authed)/orders/_components/order-detail';
import { DEV_ORDER_ID, FIXTURE_IDS, fixture, type FixtureId } from './fixtures.dev';
import '@skydrop/ui/brand/scales.css';
import '@skydrop/ui/brand/theme.css';
import '@skydrop/ui/brand/app.css';

/**
 * /dev/order-detail — the REAL redesigned client order page against MOCKED
 * API responses, so it can be looked at without a database.
 *
 * DEV ONLY: `page.dev.tsx` compiles only when APPS_DEV_ROUTES=1 (see
 * next.config.mjs), so it cannot reach a production chunk.
 *
 *   ?fixture=a..r   (see fixtures.dev.ts)   ?locale=en|bn   ?theme=light|dark
 *
 * Only `fetch` is faked: every component, hook and request below is the real
 * one. A mutation answers 200 with an empty body, so a dialog can be driven
 * to its end without touching anything.
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
    if (!path.startsWith('/api/')) return real(input, init);
    const f = fixture(current);
    const method = (init?.method ?? 'GET').toUpperCase();
    const calls = ((window as unknown as { __odCalls?: unknown[] }).__odCalls ??= []);
    if (method !== 'GET') calls.push({ method, path, body: init?.body ?? null });
    await new Promise((r) => setTimeout(r, 60));
    if (method !== 'GET') return json({});
    const base = `/api/seller/orders/${DEV_ORDER_ID}`;
    if (path === base) return json(f.order);
    if (path === `${base}/journey`) return json(f.journey);
    if (path === `${base}/charges`) return json(f.charges);
    if (path === `${base}/invoice`) {
      return f.invoice === null
        ? json({ code: 'NOT_FOUND', message: 'none' }, 404)
        : json(f.invoice);
    }
    if (path === `${base}/reattempt-requests`) return json(f.reattempts);
    if (path === `${base}/delivery-actions`) return json(f.deliveryActions);
    if (path === `${base}/call-history`) return json(f.calls);
    if (path === `${base}/address-check`) {
      return f.check === null ? json({ code: 'NOT_FOUND', message: 'none' }, 404) : json(f.check);
    }
    if (path === `${base}/reseller-money`) {
      return f.resellerMoney === null
        ? json({ code: 'NOT_FOUND', message: 'none' }, 404)
        : json(f.resellerMoney);
    }
    if (path === `${base}/consignee`) {
      return json({
        editable: true,
        reason: 'The courier still accepts changes until the parcel is picked up.',
        currentName: (f.order['recipientName'] as string) ?? '',
        currentPhone: (f.order['recipientPhoneE164'] as string) ?? '',
        currentAddressLine1: (f.order['recipientAddressLine1'] as string) ?? '',
        city: (f.order['recipientCity'] as string) ?? '',
        stateProvince: (f.order['recipientStateProvince'] as string) ?? '',
        postalCode: (f.order['recipientPostalCode'] as string) ?? '',
      });
    }
    if (path === `${base}/consignee/history`) return json([]);
    if (path === '/api/seller/tickets') return json(f.tickets);
    if (path === '/api/seller/early-reservation-reviews') return json(f.holdReviews);
    if (path === '/api/seller/pricing/fees') return json({ items: [] });
    return json({ code: 'NOT_MOCKED', message: path }, 404);
  };
}

const LOCALES: readonly Locale[] = ['en', 'bn'];
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

const BAR: CSSProperties = {
  display: 'flex',
  gap: 4,
  flexWrap: 'wrap',
  padding: 4,
  background: 'var(--surface-3)',
  color: 'var(--fg-body)',
  fontSize: 12,
};
// Stands in for the console's sticky 56px top bar, so the page's own sticky
// header can be checked against something real.
const TOP: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 30,
  minHeight: 56,
  background: 'var(--surface)',
  borderBottom: '1px solid var(--line)',
};
const RAIL_CSS =
  '.odh-shell{display:flex}.odh-rail{display:none}@media(min-width:1024px){.odh-rail{display:block;flex:none;width:248px;background:var(--surface);border-right:1px solid var(--line)}}' +
  '.odh-main{flex:1;min-width:0;padding:12px 12px 24px}@media(min-width:640px){.odh-main{padding:20px 20px 24px}}@media(min-width:1024px){.odh-main{padding:24px}}';

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

  // Set DURING render, not in an effect: the children's queries fire in THEIR
  // effects, which run before this component's, and would otherwise read the
  // previous fixture.
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
    id: 'seller-user-dev',
    roleKey: 'owner',
    roleName: 'Owner',
    roleKeys: ['owner'],
    roleNames: ['Owner'],
    permissions: fixture(fixtureId).permissions,
    email: 'dev@skydrop.global',
    emailDisplay: 'dev@skydrop.global',
    companyName: 'Dev Store',
    displayCurrency: 'INR',
    displayFxRate: null,
    equivalentFxRate: '1.43',
  } as unknown as SellerMe;

  return (
    <div
      style={{ '--top-h': '56px', minHeight: '100vh', background: 'var(--page)' } as CSSProperties}
    >
      <div style={TOP} data-harness-bar>
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
          <main className="odh-main">
            <LocaleProvider key={`${fixtureId}-${locale}`} initialLocale={locale}>
              <QueryProvider key={`${fixtureId}-${locale}`}>
                <AuthProvider<SellerMe> identityKind="seller" initialIdentity={identity}>
                  <MoneyDisplayProvider
                    value={{ currency: 'INR', rate: null, equivalentRate: '1.43' }}
                  >
                    <Toaster>
                      <ToastProvider>
                        <OrderDetailView orderId={DEV_ORDER_ID} />
                      </ToastProvider>
                    </Toaster>
                  </MoneyDisplayProvider>
                </AuthProvider>
              </QueryProvider>
            </LocaleProvider>
          </main>
        </div>
      ) : null}
    </div>
  );
}
