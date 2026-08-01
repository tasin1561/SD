import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode, ReactElement } from 'react';
import { resolveSellerSsrIdentity } from '@skydrop/auth/server';
import { AuthProvider } from '@skydrop/auth/client';
import type { SellerMe } from '@skydrop/api-client';
import { QueryProvider } from '@/components/query-provider';
import { apiOrigin } from '@/lib/api-origin';
import { AuthedShell } from './_components/authed-shell';
import { RoleBoundary } from './_components/role-boundary';

/**
 * Authed route group layout — the GATE.
 *
 * SSR auth flow (FE-4):
 *   1. Read the __Host-sellerRefresh cookie from the incoming request.
 *   2. Server-to-server fetch /auth/seller/me with the cookie. The
 *      hybrid /me (M12 commit 1) is READ-ONLY on the cookie path —
 *      it does NOT rotate. So this SSR call can never race the
 *      client's silent-refresh.
 *   3. On 401 → redirect to /login. On a 5xx (network) → throw,
 *      which Next renders via error.tsx (service unavailable, NOT
 *      logged-out — outage shouldn't masquerade as auth failure).
 *   4. On 200 → hydrate the AuthProvider with the SellerMe identity;
 *      the client-side single-flight refresh kicks in from there.
 *
 * The token in browser memory is empty on every page boot — the
 * silent-refresh on the first 401 lays one down. This is by
 * design (FE-1): no persistence + cookie-only durability + lazy
 * client-side token.
 *
 * Identical shape to apps/admin's (authed) layout; the FE-5
 * identity-parameterization is the entire difference (StaffMe →
 * SellerMe, resolveStaffSsrIdentity → resolveSellerSsrIdentity,
 * __Host-staffRefresh → __Host-sellerRefresh).
 */
export default async function AuthedLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const jar = await cookies();
  const cookieValue = jar.get('__Host-sellerRefresh')?.value ?? '';

  const result = await resolveSellerSsrIdentity({
    apiOrigin: apiOrigin(),
    identityKind: 'seller',
    cookieValue,
  });

  if (result.state !== 'authenticated') {
    redirect('/login');
  }

  const identity: SellerMe = result.identity;

  return (
    <QueryProvider>
      <AuthProvider<SellerMe> identityKind="seller" initialIdentity={identity}>
        <AuthedShell identity={identity}>
          {/* Cosmetic role gating (FE-2) — the server refuses the
              requests regardless; this stops a role being shown a
              page it cannot use. Wraps the whole tree so no page
              can be forgotten. */}
          <RoleBoundary role={identity.role}>{children}</RoleBoundary>
        </AuthedShell>
      </AuthProvider>
    </QueryProvider>
  );
}
