import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveStaffSsrIdentity } from '@skydrop/auth/server';
import { apiOrigin } from '@/lib/api-origin';
import { TiltPanel } from '@/lib/tilt';
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
        <div className="telemetry text-text-muted mt-2">operations console</div>
      </div>

      <TiltPanel max={3} className="boot-rise boot-rise-2">
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface ticks p-6 sm:p-7">
          <div className="mb-3 flex items-center justify-between">
            <span className="telemetry" style={{ color: 'var(--sky)' }}>
              access
            </span>
            <span className="telemetry text-text-muted">staff only</span>
          </div>
          <h1 className="text-text-bright text-lg font-semibold mb-1">Sign in</h1>
          <p className="text-text-muted text-sm mb-6">
            Staff portal — accounts are created by invitation.
          </p>
          <LoginForm />
          <div aria-hidden className="glow-follow" />
        </div>
      </TiltPanel>

      {/* It used to say "contact your admin", which for the SUPER_ADMIN
          reading it means contact yourself — and for everyone else meant
          waiting on somebody with a database console. The API and the
          reset page both existed; only the way in was missing. */}
      <div className="boot-rise boot-rise-3 telemetry text-text-muted mt-5 text-center">
        <a href="/auth/forgot-password" className="hover:text-text-bright transition-colors">
          forgot password?
        </a>
      </div>
    </>
  );
}
