import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveStoreSsrIdentity } from '@skydrop/auth/server';
import { apiOrigin } from '@/lib/api-origin';
import { AuthFrame } from '@/components/auth-frame';
import { LoginForm } from './_components/login-form';
import './_components/rd-auth.css';

/**
 * Sign in. A visitor who already holds a valid `__Host-storeRefresh`
 * cookie is sent straight to the dashboard — resolved read-only through
 * /me (FE-4), never a refresh.
 */
export default async function LoginPage(): Promise<ReactElement> {
  const cookieValue = (await cookies()).get('__Host-storeRefresh')?.value ?? '';
  if (cookieValue) {
    const result = await resolveStoreSsrIdentity({
      apiOrigin: apiOrigin(),
      identityKind: 'store',
      cookieValue,
    });
    if (result.state === 'authenticated') redirect('/dashboard');
  }

  return (
    <AuthFrame
      title="Sign in"
      subtitle="Use the login from your store invitation."
      footer={
        <>
          Forgot your password? <a href="/password-reset">Reset it</a>
          {/*
           * The way OUT to the seller portal.
           *
           * The two portals look near-identical now that this one wears
           * the corridor console, and only the hostname tells them
           * apart — so a seller who bookmarked this, or was forwarded a
           * store colleague's link, meets a form that will never accept
           * them and says "invalid credentials", which is true and
           * useless. A Skydrop seller signs in somewhere else entirely.
           *
           * SAME TAB, no `target="_blank"`: they are going there to sign
           * in, not to consult something, and a new tab would leave a
           * dead login behind them. Both /login pages bounce an
           * already-authenticated visitor to their own dashboard, so
           * this is safe in either direction and needs no query string.
           */}
          <span className="rd-auth-alt">
            Looking for the seller portal?{' '}
            <a href="https://app.skydrop.online/login">Sign in there</a>
          </span>
        </>
      }
    >
      <LoginForm />
    </AuthFrame>
  );
}
