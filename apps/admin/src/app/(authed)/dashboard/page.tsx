import type { ReactElement } from 'react';

/**
 * CP1 dashboard — intentionally minimal. The CP1 gate is the FULL
 * AUTH LOOP (login → SSR /me → refresh-through-proxy → logout), not
 * feature content. CP2 (commits 7–10) builds Seller + Order ops on
 * top of this empty page.
 */
export default function DashboardPage(): ReactElement {
  return (
    <div className="max-w-3xl">
      <h1 className="text-text-bright text-xl font-semibold tracking-tight mb-1">Welcome</h1>
      <p className="text-text-muted text-sm mb-6">
        You&apos;re signed in. Feature areas (Sellers, Orders) land in CP2 of Module 12.
      </p>

      <div className="rounded-[7px] border border-border bg-surface p-4 mb-3">
        <div className="text-text-faint text-xs uppercase tracking-wide mb-2">Session status</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div className="text-text-muted">Identity source</div>
          <div className="text-text-body">
            SSR cookie → <span className="font-mono text-xs">/auth/staff/me</span> (read-only)
          </div>
          <div className="text-text-muted">Access token</div>
          <div className="text-text-body">In-memory (browser), not persisted</div>
          <div className="text-text-muted">Refresh path</div>
          <div className="text-text-body">
            <span className="font-mono text-xs">POST /api/auth/staff/refresh</span> via same-origin
            proxy
          </div>
          <div className="text-text-muted">Single-flight refresh</div>
          <div className="text-text-body">Enabled (1 / N concurrent 401s)</div>
        </div>
      </div>

      <div className="rounded-[7px] border border-border bg-surface p-4">
        <div className="text-text-faint text-xs uppercase tracking-wide mb-2">
          CP1 verification (manual)
        </div>
        <ol className="text-sm space-y-1 list-decimal list-inside text-text-body">
          <li>Sign in via the login page → land here.</li>
          <li>
            Wait 5+ minutes (access TTL) OR open DevTools and clear the in-memory token by reloading
            — but in-memory tokens don&apos;t survive reload by design.
          </li>
          <li>
            Trigger any subsequent authed request (navigation, future CP2 feature) → DevTools
            Network should show ONE silent
            <span className="font-mono mx-1">POST /api/auth/staff/refresh</span>
            returning 200 + a fresh <span className="font-mono">__Host-staffRefresh</span>{' '}
            Set-Cookie.
          </li>
          <li>
            Sign out → cookie cleared, redirect to /login. Re-visit any /dashboard URL → SSR /me 401
            → /login.
          </li>
        </ol>
      </div>
    </div>
  );
}
