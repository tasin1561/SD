import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';
import { resolveStoreSsrIdentity } from '@skydrop/auth/server';
import { AuthProvider } from '@skydrop/auth/client';
import type { StoreMe } from '@skydrop/api-client';
import { QueryProvider } from '@/components/query-provider';
import { apiOrigin } from '@/lib/api-origin';
import { AuthedShell } from './_components/authed-shell';
import { RoleBoundary } from './_components/role-boundary';

/**
 * The GATE (ASSOC-1) — the store identity's authed layout (FE-5: the
 * identity kind is a parameter, nothing else changes):
 * `__Host-storeRefresh` → the read-only /me (FE-4, NEVER a refresh, which
 * would race the client's silent refresh and burn a legitimate session on
 * the API's reuse detection) → hydrate `AuthProvider<StoreMe>`.
 *
 * Not authenticated, or refused because the store is closed or not yet
 * approved → the sign-in page, which says why when they try. A 5xx throws
 * to error.tsx: an outage must not read as "logged out".
 *
 * ── NO IMPERSONATION COOKIE IS READ HERE, DELIBERATELY ──────────────
 * A staff support session into a reseller store is opened against the
 * STORE portal, which carries the IMP-6 banner. Accepting the session
 * cookie here would let a staff member work inside somebody's account on
 * a screen with nothing saying so, and IMP-6's whole argument is that the
 * risk this feature carries is one person who has forgotten whose account
 * they are in. So this portal is for the account's own people; a staff
 * member is sent to /login.
 */
export default async function AuthedLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const cookieValue = (await cookies()).get('__Host-storeRefresh')?.value ?? '';
  const result = await resolveStoreSsrIdentity({
    apiOrigin: apiOrigin(),
    identityKind: 'store',
    cookieValue,
  });
  if (result.state !== 'authenticated') redirect('/login');
  const identity: StoreMe = result.identity;

  return (
    <QueryProvider>
      <AuthProvider<StoreMe> identityKind="store" initialIdentity={identity}>
        <AuthedShell identity={identity}>
          {/* Cosmetic (FE-2): the API refuses regardless of what renders. */}
          <RoleBoundary permissions={identity.permissions}>{children}</RoleBoundary>
        </AuthedShell>
      </AuthProvider>
    </QueryProvider>
  );
}
