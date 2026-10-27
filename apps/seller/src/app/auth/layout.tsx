import type { ReactNode, ReactElement } from 'react';
import { SellerSignInFrame } from '@/components/auth-frame';

/**
 * Every /auth page (accept an invitation, set or reset a password, verify
 * an email) in the shared SignInFrame. Wide, because the account-setup
 * forms carry more fields than the sign-in card.
 */
export default function SellerAuthLayout({ children }: { children: ReactNode }): ReactElement {
  return <SellerSignInFrame wide>{children}</SellerSignInFrame>;
}
