import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveStoreSsrIdentity } from '@skydrop/auth/server';
import { apiOrigin } from '@/lib/api-origin';
import { AuthFrame } from '@/components/auth-frame';
import { LoginForm } from './_components/login-form';
import './_components/as-auth.css';

/**
 * Sign in. A visitor who already holds a valid `__Host-storeRefresh`
 * cookie is sent straight to their orders — resolved read-only through
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
    if (result.state === 'authenticated') redirect('/orders');
  }

  return (
    <AuthFrame
      title="Sign in"
      subtitle="Use the login from the invitation your store sent you."
      footer={
        <>
          Forgot your password? <a href="/password-reset">Reset it</a>
          {/*
           * The way OUT to the store portal.
           *
           * This portal and the store's own look alike and only the
           * hostname tells them apart, so somebody who runs the store
           * and was forwarded a colleague's link would meet a form that
           * accepts them perfectly and then shows them a far smaller
           * app than the one they are looking for. Same tab: they are
           * going there to sign in, and both /login pages bounce an
           * already-authenticated visitor onward.
           */}
          <span className="as-auth-alt">
            Run the store yourself?{' '}
            <a href="https://reseller.skydrop.global/login">Sign in to the store portal</a>
          </span>
        </>
      }
    >
      <LoginForm />
    </AuthFrame>
  );
}
