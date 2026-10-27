import type { ReactNode, ReactElement } from 'react';
import { SellerSignInFrame } from '@/components/auth-frame';

/** Asking for a reset link is the same front door as signing in. */
export default function PasswordResetLayout({ children }: { children: ReactNode }): ReactElement {
  return <SellerSignInFrame>{children}</SellerSignInFrame>;
}
