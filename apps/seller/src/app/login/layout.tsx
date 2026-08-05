import type { ReactNode, ReactElement } from 'react';
import { AuthConsoleShell } from '@/components/auth-console/console-shell';

/**
 * Login layout — bare, no AuthProvider. If a SSR-authenticated seller
 * lands here, the login page itself redirects them onward; we don't gate
 * access. The (authed) layout is the gate.
 *
 * The backdrop now lives in `AuthConsoleShell`, shared with everything
 * under /auth and /password-reset — see the note there for why those
 * pages had no skin at all until this was extracted.
 */
export default function LoginLayout({ children }: { children: ReactNode }): ReactElement {
  return <AuthConsoleShell>{children}</AuthConsoleShell>;
}
