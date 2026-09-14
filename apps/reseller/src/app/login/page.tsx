import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveStoreSsrIdentity } from '@skydrop/auth/server';
import { apiOrigin } from '@/lib/api-origin';
import { AuthFrame } from '@/components/auth-frame';
import { LoginForm } from './_components/login-form';

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
          Forgot your password?{' '}
          <a href="/password-reset" className="text-accent hover:text-accent-hover">
            Reset it
          </a>
        </>
      }
    >
      <LoginForm />
    </AuthFrame>
  );
}
