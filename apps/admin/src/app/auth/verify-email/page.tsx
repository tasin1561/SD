import type { ReactElement } from 'react';
import { AuthConsoleHeader } from '@/components/auth-console/console-shell';
import { TiltPanel } from '@/lib/tilt';
import { VerifyEmailPanel } from './_components/verify-panel';

/**
 * Staff email verification, linked from the verification email as
 * `/auth/verify-email?token=…`.
 *
 * Same story as the reset page: the API had been mailing this URL and
 * nothing served it, so the link 404'd. Shell and card match /login
 * for the same reason — this is often the first screen a new staff
 * member sees.
 */
export default async function StaffVerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ readonly token?: string | string[] }>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (rawToken ?? '').trim();

  return (
    <>
      <AuthConsoleHeader label="operations console" />

      <TiltPanel max={3} className="boot-rise boot-rise-2">
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface ticks p-6 sm:p-7">
          <div className="mb-3 flex items-center justify-between">
            <span className="telemetry" style={{ color: 'var(--sky)' }}>
              verify identity
            </span>
            <span className="telemetry text-text-muted">single use</span>
          </div>

          <h1 className="text-text-bright text-lg font-semibold mb-1">Verify your email</h1>

          {token === '' ? (
            <>
              <p className="text-text-muted text-sm mb-6">
                The link is missing its verification token. Open the email again and use the button
                there rather than copying the address by hand.
              </p>
              <a
                href="/login"
                className="block text-center w-full px-3 py-1.5 rounded-[5px] bg-accent-fill text-accent-fg text-sm font-medium hover:bg-accent-fill-hover transition-colors"
              >
                Back to sign in
              </a>
            </>
          ) : (
            <>
              <p className="text-text-muted text-sm mb-6">
                Confirming the address on your staff account.
              </p>
              <VerifyEmailPanel token={token} />
            </>
          )}
          <div aria-hidden className="glow-follow" />
        </div>
      </TiltPanel>

      <div className="boot-rise boot-rise-3 telemetry text-text-muted text-center mt-5">
        <a href="/login" className="hover:text-text-body transition-colors">
          back to sign in
        </a>
      </div>
    </>
  );
}
