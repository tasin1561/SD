import type { ReactNode, ReactElement } from 'react';
import { AuthConsoleShell } from '@/components/auth-console/console-shell';

/**
 * Login layout — bare, no AuthProvider. If a SSR-authenticated user
 * lands here, the login page itself redirects them onward; we don't
 * gate access. The (authed) layout is the gate.
 *
 * The skin lives in AuthConsoleShell, shared with /auth/*.
 */
export default function LoginLayout({ children }: { children: ReactNode }): ReactElement {
  return <AuthConsoleShell>{children}</AuthConsoleShell>;
}
