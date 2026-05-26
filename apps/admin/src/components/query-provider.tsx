'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode, type ReactElement } from 'react';

/**
 * One QueryClient per browser session, reused across navigations.
 * `useState(() => new QueryClient(...))` keeps the instance stable
 * across re-renders of this provider (the lazy initializer guarantees
 * it's created exactly once per mount).
 *
 * Defaults:
 *  - staleTime: 30s — most admin data is read-mostly + busy operators
 *    expect freshness; aggressive refetch causes flicker. 30s is the
 *    Linear/Stripe-dashboard ballpark.
 *  - refetchOnWindowFocus: false — operators switch tabs constantly;
 *    auto-refetch would be a UX wall. Mutations + manual refresh are
 *    the freshness path.
 *  - retry: false on mutations (the user sees the error inline);
 *    retry once on queries (network blips).
 */
export function QueryProvider({ children }: { children: ReactNode }): ReactElement {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
