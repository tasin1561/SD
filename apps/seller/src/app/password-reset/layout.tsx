import type { ReactNode, ReactElement } from 'react';
import { AuthConsoleShell } from '@/components/auth-console/console-shell';

/** Asking for a reset link is the same front door as signing in. */
export default function PasswordResetLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <AuthConsoleShell contentClassName="flex w-full justify-center">{children}</AuthConsoleShell>
  );
}
