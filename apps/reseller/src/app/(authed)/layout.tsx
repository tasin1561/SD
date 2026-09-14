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
 * The GATE (RS-2) — apps/seller's authed layout with the identity
 * parameter changed (FE-5): `__Host-storeRefresh` → the read-only /me
 * (FE-4, never a refresh) → hydrate `AuthProvider<StoreMe>`.
 *
 * Not authenticated, or FORBIDDEN (the store was closed or is not yet
 * approved) → the sign-in page, which says why when they try. A 5xx
 * throws to error.tsx: an outage must not read as "logged out".
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
