'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode, type ReactElement } from 'react';
import { useApiClient } from '@skydrop/auth/client';
import type { StaffMe } from '@skydrop/api-client';
import { Toaster } from '@skydrop/ui/components';

/**
 * The dark-primary admin shell — fixed sidebar, slim topbar, dense
 * content area. CP1 ships only the nav skeleton (Dashboard) — the
 * CP2 feature pages (Sellers, Orders) slot in at commits 7-10.
 *
 * Lineage: Linear / Vercel dashboard — quiet chrome, the content is
 * the star. No grain, no animations, no celebration. The status
 * colors elsewhere do the talking.
 */
export function AuthedShell({
  identity,
  children,
}: {
  identity: StaffMe;
  children: ReactNode;
}): ReactElement {
  const pathname = usePathname();
  const client = useApiClient();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout(): Promise<void> {
    setLoggingOut(true);
    try {
      await client.logout();
    } finally {
      // Hard navigation so SSR re-runs cleanly without stale React
      // state. router.replace('/login') + refresh would also work.
      window.location.assign('/login');
    }
  }

  const navItems: { href: string; label: string }[] = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/sellers', label: 'Sellers' },
    { href: '/orders', label: 'Orders' },
    { href: '/catalog/categories', label: 'Categories' },
    { href: '/call-center', label: 'Call centre' },
    { href: '/warehouse', label: 'Warehouse' },
    { href: '/remittances', label: 'Remittances' },
    { href: '/reports', label: 'Reports' },
    { href: '/settings', label: 'Settings' },
  ];

  return (
    <Toaster>
    <div className="grid min-h-screen grid-cols-[220px_1fr] bg-bg text-text-body">
      {/* Sidebar */}
      <aside className="border-r border-border bg-surface flex flex-col">
        <div className="px-4 py-5 border-b border-border">
          <div className="text-text-bright font-semibold tracking-tight text-base">Skydrop</div>
          <div className="text-text-faint text-xs mt-0.5">Admin</div>
        </div>
        <nav className="flex flex-col py-2">
          {navItems.map((item) => {
            const active = pathname?.startsWith(item.href) ?? false;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  'mx-2 my-0.5 px-3 py-1.5 rounded-[5px] text-sm transition-colors ' +
                  (active
                    ? 'bg-surface-hover text-text-bright'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-body')
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-4 py-3 border-t border-border text-xs text-text-faint">
          Phase 1A · M12 CP1
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-col min-w-0">
        <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-border bg-surface">
          <div className="text-text-muted text-xs uppercase tracking-wide">
            Staff Dashboard
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="text-right leading-tight">
              <div className="text-text-body">{identity.emailDisplay}</div>
              <div className="text-text-faint">{identity.role}</div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="px-2.5 py-1 rounded-[5px] border border-border text-text-muted hover:border-border-strong hover:text-text-body disabled:opacity-50 transition-colors"
            >
              {loggingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </header>
        <main className="flex-1 min-w-0 px-6 py-6 overflow-auto">{children}</main>
      </div>
    </div>
    </Toaster>
  );
}
