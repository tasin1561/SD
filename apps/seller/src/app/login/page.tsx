import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSellerSsrIdentity } from '@skydrop/auth/server';
import { SignInCard } from '@skydrop/ui/app/sign-in';
import { apiOrigin } from '@/lib/api-origin';
import { LoginForm } from './_components/login-form';

/**
 * Login entry. If the visitor already has a valid __Host-sellerRefresh
 * cookie, skip the form and redirect to the dashboard — saves a
 * roundtrip for already-authed sellers who bookmarked /login.
 *
 * The brand line ("Skydrop" + "seller portal"), the backdrop and the
 * theme switch belong to the layout's `SignInFrame`; this page renders
 * only its card. It must NOT repeat the wordmark — the login spec
 * requires "Skydrop" exactly once on the page.
 */
export default async function LoginPage(): Promise<ReactElement> {
  const jar = await cookies();
  const cookieValue = jar.get('__Host-sellerRefresh')?.value ?? '';
  if (cookieValue) {
    const result = await resolveSellerSsrIdentity({
      apiOrigin: apiOrigin(),
      identityKind: 'seller',
      cookieValue,
    });
    if (result.state === 'authenticated') {
      redirect('/dashboard');
    }
  }

  return (
    <SignInCard
      title="Sign in"
      note="Use the credentials from your Skydrop invitation."
      footer={
        <>
          <p>
            Forgot your password? <a href="/password-reset">Reset it</a>
          </p>
          {/*
           * The way OUT to the store portal.
           *
           * The two portals look near-identical, and the only thing
           * telling them apart is the hostname — so somebody who
           * bookmarked the wrong one, or was forwarded a colleague's
           * link, meets a form that will never accept them and says
           * "invalid credentials", which is true and useless. A store
           * user is not a seller and never will be here.
           *
           * SAME TAB, no `target="_blank"`: they are going there to sign
           * in, not to consult something, and a new tab would leave a dead
           * login behind them. (`rel="noopener"` does nothing without a
           * target, so it is not cargo-culted in.) Both /login pages bounce
           * an already-authenticated visitor to their own dashboard, so
           * this is safe in either direction and needs no query string.
           */}
          <p>
            Run a store? <a href="https://reseller.skydrop.online/login">Store sign-in</a>
          </p>
        </>
      }
    >
      <LoginForm />
    </SignInCard>
  );
}
