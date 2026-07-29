import type { ReactNode, ReactElement } from 'react';
import { AuthConsoleShell } from '@/components/auth-console/console-shell';

/**
 * Everything under /auth — reset password, verify email, accept
 * invitation — is reached from an email link by someone who is not
 * signed in. Same shell as /login, for the same reason: it is the
 * product's front door.
 */
export default function AuthLayout({ children }: { children: ReactNode }): ReactElement {
  return <AuthConsoleShell>{children}</AuthConsoleShell>;
}
