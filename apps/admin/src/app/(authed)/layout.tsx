import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode, ReactElement } from 'react';
import { resolveStaffSsrIdentity } from '@skydrop/auth/server';
import { AuthProvider } from '@skydrop/auth/client';
import type { StaffMe } from '@skydrop/api-client';
import { QueryProvider } from '@/components/query-provider';
import { apiOrigin } from '@/lib/api-origin';
import { AuthedShell } from './_components/authed-shell';

/**
 * Authed route group layout — the GATE.
 *
 * SSR auth flow (FE-4):
 *   1. Read the __Host-staffRefresh cookie from the incoming request.
 *   2. Server-to-server fetch /auth/staff/me with the cookie. The
 *      hybrid /me (M12 commit 1) is READ-ONLY on the cookie path —
 *      it does NOT rotate. So this SSR call can never race the
 *      client's silent-refresh.
 *   3. On 401 → redirect to /login. On a 5xx (network) → throw,
 *      which Next renders via error.tsx (CP1.6 will add one).
 *   4. On 200 → hydrate the AuthProvider with the StaffMe identity;
 *      the client-side single-flight refresh kicks in from there.
 *
 * The token in browser memory is empty on every page boot — the
 * silent-refresh on the first 401 lays one down. This is by
 * design (FE-1): no persistence + cookie-only durability + lazy
 * client-side token.
 */
export default async function AuthedLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const jar = await cookies();
  const cookieValue = jar.get('__Host-staffRefresh')?.value ?? '';

  const result = await resolveStaffSsrIdentity({
    apiOrigin: apiOrigin(),
    identityKind: 'staff',
    cookieValue,
  });

  if (result.state !== 'authenticated') {
    redirect('/login');
  }

  const identity: StaffMe = result.identity;

  return (
    <QueryProvider>
      <AuthProvider<StaffMe> identityKind="staff" initialIdentity={identity}>
        <AuthedShell identity={identity}>{children}</AuthedShell>
      </AuthProvider>
    </QueryProvider>
  );
}
