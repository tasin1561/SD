import type { ReactNode, ReactElement } from 'react';

/**
 * Login layout — bare, no AuthProvider. If a SSR-authenticated user
 * lands here, the login page itself redirects them onward; we don't
 * gate access. The (authed) layout is the gate.
 */
export default function LoginLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <div className="min-h-screen grid place-items-center bg-bg text-text-body p-6">
      {children}
    </div>
  );
}
