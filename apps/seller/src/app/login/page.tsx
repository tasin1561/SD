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
 *
 * ── The panel head is the console's SECTION BAND, in the login idiom ──
 * Inside the app a region is capped by `NN // NAME` with a quiet note
 * to its right. Here there is one region and no reading order to
 * number, so it is the accent dot, the name, and the note — the same
 * three parts, the same mono caps, no invented ordinal. Every page
 * under /auth wears it, which is what stops the front door reading as
 * a different product from the console behind it.
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
        <div className="flex items-center justify-center gap-3">
          {/* Decorative — the wordmark beside it already names the brand. */}
          <img
            src="/brand/skydrop-icon.svg"
            alt=""
            aria-hidden="true"
            width={74}
            height={36}
            className="h-9 w-auto shrink-0 select-none"
            draggable={false}
          />
          <span className="text-text-bright text-2xl font-semibold tracking-tight">Skydrop</span>
          <span className="telemetry text-text-muted inline-flex items-center gap-1.5">
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
        <div className="border-border bg-surface ticks relative overflow-hidden rounded-[var(--radius-3)] border p-6 sm:p-7">
          <div className="border-border mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b pb-3">
            <span className="telemetry text-text-strong inline-flex items-center gap-2">
              <span aria-hidden className="bg-accent h-1.5 w-1.5 shrink-0 rounded-full" />
              access
            </span>
            <span className="telemetry text-text-faint">invite-only</span>
          </div>
          <h1 className="text-text-bright mb-1 text-lg font-semibold">Sign in</h1>
          <p className="text-text-muted mb-6 text-sm">
            Use the credentials from your Skydrop invitation.
          </p>
          <LoginForm />
          <div aria-hidden className="glow-follow" />
        </div>
      </TiltPanel>

      <div className="boot-rise boot-rise-3 telemetry text-text-muted mt-5 text-center">
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
