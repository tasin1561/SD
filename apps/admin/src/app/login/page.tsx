import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveStaffSsrIdentity } from '@skydrop/auth/server';
import { apiOrigin } from '@/lib/api-origin';
import { SignInCard } from '@skydrop/ui/app/sign-in';
import { LoginForm } from './_components/login-form';

/**
 * Login entry. If the visitor already has a valid __Host- cookie,
 * skip the form and redirect to the dashboard — saves a roundtrip
 * for already-authed users who bookmarked /login.
 */
export default async function LoginPage(): Promise<ReactElement> {
  const jar = await cookies();
  const cookieValue = jar.get('__Host-staffRefresh')?.value ?? '';
  if (cookieValue) {
    const result = await resolveStaffSsrIdentity({
      apiOrigin: apiOrigin(),
      identityKind: 'staff',
      cookieValue,
    });
    if (result.state === 'authenticated') {
      redirect('/dashboard');
    }
  }

  return (
    <SignInCard
      title="Sign in"
      note="Staff portal — accounts are created by invitation."
      footer={
        // It used to say "contact your admin", which for the SUPER_ADMIN
        // reading it means contact yourself — and for everyone else meant
        // waiting on somebody with a database console. The API and the
        // reset page both existed; only the way in was missing.
        <a href="/auth/forgot-password">Forgot your password?</a>
      }
    >
      <LoginForm />
    </SignInCard>
  );
}
