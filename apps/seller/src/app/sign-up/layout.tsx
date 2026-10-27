import type { ReactNode, ReactElement } from 'react';
import { SellerSignInFrame } from '@/components/auth-frame';

/** Asking how to get an account is the same front door as signing in. */
export default function SignUpLayout({ children }: { children: ReactNode }): ReactElement {
  return <SellerSignInFrame>{children}</SellerSignInFrame>;
}
