import type { ReactElement } from 'react';
import { TiltPanel } from '@/lib/tilt';
import { ResetPasswordForm } from './_components/reset-form';

/**
 * Step 2 of the seller password-reset flow — the "confirm with new
 * password" page. Linked to from the password-reset email
 * (`/auth/reset-password?token=...`).
 *
 * If the token is missing from the URL we render a small "invalid
 * link" panel; otherwise the client form lets the seller set a new
 * password and posts to /auth/seller/password-reset/confirm. The API
 * clears any existing seller refresh cookie on success, so they have
 * to sign in fresh.
 *
 * The panel head's right-hand cap reports WHICH of those two it is, so
 * the state of the link is legible before the prose is read.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ readonly token?: string | string[] }>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (rawToken ?? '').trim();

  return (
    <div className="w-full max-w-sm">
      <div className="boot-rise mb-6 text-center">
        <div className="flex items-center justify-center gap-2.5">
          {/* Decorative — the wordmark beside it already names the brand. */}
          <img
            src="/brand/skydrop-icon.svg"
            alt=""
            aria-hidden="true"
            width={53}
            height={26}
            className="h-[26px] w-auto shrink-0 select-none"
            draggable={false}
          />
          <span className="text-text-bright text-lg font-semibold tracking-tight">Skydrop</span>
        </div>
        <div className="telemetry text-text-muted mt-1.5">seller portal</div>
      </div>

      <TiltPanel max={3} className="boot-rise boot-rise-2">
        <div className="border-border bg-surface ticks relative overflow-hidden rounded-[var(--radius-3)] border p-6 sm:p-7">
          <div className="border-border mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b pb-3">
            <span className="telemetry text-text-strong inline-flex items-center gap-2">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${token === '' ? 'bg-critical' : 'bg-accent'}`}
              />
              recovery
            </span>
            <span className="telemetry text-text-faint">
              {token === '' ? 'link incomplete' : 'step 2 of 2'}
            </span>
          </div>
          {token === '' ? (
            <>
              <h1 className="text-text-bright mb-1 text-base font-semibold">Invalid reset link</h1>
              <p className="text-text-muted mb-4 text-xs leading-relaxed">
                The link is missing the reset token. Open the reset email again and click the button
                there, or request a new link.
              </p>
              <a
                href="/password-reset"
                className="bg-accent-fill text-accent-fg hover:bg-accent-fill-hover inline-block rounded-[var(--radius-2)] px-3 py-1.5 text-sm font-medium transition-colors"
              >
                Request a new link
              </a>
            </>
          ) : (
            <>
              <h1 className="text-text-bright mb-1 text-base font-semibold">
                Choose a new password
              </h1>
              <p className="text-text-muted mb-5 text-xs leading-relaxed">
                Minimum 10 characters. After saving you&apos;ll need to sign in again.
              </p>
              <ResetPasswordForm token={token} />
            </>
          )}
          <div aria-hidden className="glow-follow" />
        </div>
      </TiltPanel>

      <div className="boot-rise boot-rise-3 telemetry text-text-muted mt-5 text-center">
        <a
          href="/login"
          className="hover:text-text-bright transition-colors"
          style={{ color: 'var(--sky)' }}
        >
          back to sign in
        </a>
      </div>
    </div>
  );
}
