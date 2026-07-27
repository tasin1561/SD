import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSellerSsrIdentity } from '@skydrop/auth/server';
import { apiOrigin } from '@/lib/api-origin';
import { TiltPanel } from '@/lib/tilt';
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
    <>
      <div className="boot-rise mb-6 text-center">
        <div className="flex items-baseline justify-center gap-3">
          <span className="text-text-bright font-semibold text-2xl tracking-tight">Skydrop</span>
          <span className="telemetry inline-flex items-center gap-1.5 text-text-muted">
            <span
              aria-hidden
              className="status-dot inline-block h-1 w-1 rounded-full"
              style={{ background: 'var(--green)' }}
            />
            sys online
          </span>
        </div>
        <div className="telemetry text-text-muted mt-2">seller portal</div>
      </div>

      <TiltPanel max={3} className="boot-rise boot-rise-2">
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface ticks p-6 sm:p-7">
          <div className="mb-3 flex items-center justify-between">
            <span className="telemetry" style={{ color: 'var(--sky)' }}>
              access
            </span>
            <span className="telemetry text-text-muted">invite-only</span>
          </div>
          <h1 className="text-text-bright text-lg font-semibold mb-1">Sign in</h1>
          <p className="text-text-muted text-sm mb-6">
            Use the credentials from your Skydrop invitation.
          </p>
          <LoginForm />
          <div aria-hidden className="glow-follow" />
        </div>
      </TiltPanel>

      <div className="boot-rise boot-rise-3 telemetry text-text-muted text-center mt-5">
        forgot password?{' '}
        <a
          href="/password-reset"
          className="hover:text-text-bright transition-colors"
          style={{ color: 'var(--sky)' }}
        >
          reset
        </a>
      </div>
    </>
  );
}
