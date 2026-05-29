import type { ReactElement } from 'react';

/**
 * Dashboard — placeholder for CP1.3. CP1.5 wraps this route under the
 * (authed) gate (cookie→/me, FE-4); CP1.6 wires the seller shell
 * (sidebar + topbar) at the (authed)/layout.tsx; CP2 fills the
 * dashboard with synthesis panels (orders today, low stock, recent
 * dispatches). For now it just confirms the dev server boots and
 * SSR works.
 */
export default function DashboardPage(): ReactElement {
  return (
    <main style={{ padding: 'var(--space-6)' }}>
      <h1
        style={{
          fontSize: 'var(--text-xl)',
          color: 'var(--color-text-bright)',
          marginBottom: 'var(--space-2)',
        }}
      >
        Skydrop Seller
      </h1>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Dashboard placeholder. CP1 foundation in flight.
      </p>
    </main>
  );
}
