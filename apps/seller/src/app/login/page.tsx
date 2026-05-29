import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSellerSsrIdentity } from '@skydrop/auth/server';
import { apiOrigin } from '@/lib/api-origin';
import { LoginForm } from './_components/login-form';

/**
 * Login entry. If the visitor already has a valid __Host-sellerRefresh
 * cookie, skip the form and redirect to the dashboard — saves a
 * roundtrip for already-authed sellers who bookmarked /login.
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
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <div className="text-text-bright font-semibold text-lg tracking-tight">Skydrop</div>
        <div className="text-text-faint text-xs mt-0.5">Seller</div>
      </div>
      <div className="rounded-[7px] border border-border bg-surface p-6">
        <h1 className="text-text-bright text-base font-semibold mb-1">Sign in</h1>
        <p className="text-text-muted text-xs mb-5">Seller portal — invite-only.</p>
        <LoginForm />
      </div>
      <div className="text-text-faint text-xs text-center mt-4">
        Forgot your password?{' '}
        <a href="/password-reset" className="text-text-muted hover:text-text-body">
          Reset
        </a>
      </div>
    </div>
  );
}
