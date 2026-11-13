'use client';

import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { AuthProvider } from '@skydrop/auth/client';
import { Toaster } from '@skydrop/ui/components';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { LocaleProvider } from '@skydrop/ui/app/i18n-client';
import type { Locale } from '@skydrop/ui/app/i18n';
import type { StaffMe } from '@skydrop/api-client';
import { QueryProvider } from '@/components/query-provider';
import '@skydrop/ui/brand/scales.css';
import '@skydrop/ui/brand/theme.css';
import '@skydrop/ui/brand/app.css';

/**
 * The shared frame for the /dev/easy/* test pages: the REAL page component
 * against MOCKED API responses, so a screen can be looked at — and driven
 * to the end of every dialog — without a database.
 *
 * Imported ONLY by `page.dev.tsx` files, which compile only when
 * APPS_DEV_ROUTES=1 (see next.config.mjs), so none of this can reach a
 * production chunk.
 *
 *   ?fixture=<id>   ?locale=en|bn|hi   ?theme=light|dark
 *
 * Only `fetch` is faked. `respond` answers a request for the current
 * fixture; return `undefined` for a path it does not know and the frame
 * answers 404 NOT_MOCKED, which shows on the page as a server verdict.
 * Every non-GET request is recorded on `window.__ezCalls`.
 */
export interface MockRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

export type Respond<F extends string> = (fixture: F, req: MockRequest) => Response | undefined;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** An ISO time `mins` minutes ago — fixtures stay "recent" whenever they are opened. */
export function ago(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

interface Live {
  fixture: string;
  respond: Respond<string>;
}
const live: Live = { fixture: '', respond: () => undefined };

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
    if (!url.pathname.startsWith('/api/')) return real(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as unknown;
      } catch {
        body = init.body;
      }
    }
    if (method !== 'GET') (w.__ezCalls ??= []).push({ method, path: url.pathname, body });
    await new Promise((r) => setTimeout(r, 80));
    return (
      live.respond(live.fixture, { method, path: url.pathname, query: url.searchParams, body }) ??
      json({ code: 'NOT_MOCKED', message: `${method} ${url.pathname}` }, 404)
    );
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

export function EasyHarness<F extends string>({
  fixtures,
  respond,
  permissions,
  children,
}: {
  readonly fixtures: readonly F[];
  readonly respond: Respond<F>;
  /** The staff permissions the fixture signs in with. */
  readonly permissions: (fixture: F) => readonly string[];
  readonly children: ReactNode;
}): ReactElement {
  const first = fixtures[0] as F;
  const [fixtureId, setFixtureId] = useState<F>(first);
  const [locale, setLocale] = useState<Locale>('en');
  const [theme, setTheme] = useState<Theme>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const f = p.get('fixture');
    const l = p.get('locale');
    const th = p.get('theme');
    if (fixtures.some((x) => x === f)) setFixtureId(f as F);
    if (LOCALES.some((x) => x === l)) setLocale(l as Locale);
    if (th === 'light' || th === 'dark') setTheme(th);
    installFetch();
    setReady(true);
    // Read once, on mount: the URL seeds the frame, the buttons drive it after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set DURING render: the children's queries fire in their effects, which
  // run before this component's, and would otherwise read the old fixture.
  live.fixture = fixtureId;
  live.respond = respond as Respond<string>;

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  const identity = {
    id: 'staff-dev',
    email: 'dev@skydrop.global',
    emailDisplay: 'dev@skydrop.global',
    permissions: permissions(fixtureId),
  } as unknown as StaffMe;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page)' }}>
      <div style={BAR} data-dev-bar>
        {fixtures.map((id) => (
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
                    {children}
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
