import type { ReactNode, ReactElement } from 'react';
import { AuthConsoleShell } from '@/components/auth-console/console-shell';

/**
 * Everything under /auth — accepting an invitation, joining a team,
 * resetting a password, verifying an email — is reached from an email
 * link by somebody who is not signed in. Same skin as /login, because
 * for most of these it is the product's front door and the first thing
 * they see.
 *
 * No width here: these pages range from a short confirmation to the full
 * registration form, and each already knows what it needs.
 */
export default function SellerAuthLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <AuthConsoleShell contentClassName="flex w-full justify-center">{children}</AuthConsoleShell>
  );
}
