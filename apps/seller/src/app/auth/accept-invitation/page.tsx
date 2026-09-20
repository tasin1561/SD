import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSellerSsrIdentity } from '@skydrop/auth/server';
import { apiOrigin } from '@/lib/api-origin';
import { TiltPanel } from '@/lib/tilt';
import { AcceptInvitationForm } from './_components/accept-invitation-form';

/**
 * Public landing page for the seller-invitation email link. Reads
 * the token from ?token= and hands it to the client form, which
 * collects the seller's registration details and posts to
 * /seller/auth/register/invite. On 201 the API issues a refresh
 * cookie + we hard-nav to /dashboard.
 *
 * If the visitor already has a valid __Host-sellerRefresh cookie,
 * they're already a seller — bounce them to the dashboard rather
 * than overwriting their session.
 *
 * Missing/empty token renders a small "invalid link" message in
 * lieu of an empty form (defensive — the token comes from a URL
 * the recipient pasted).
 *
 * This is often somebody's FIRST sight of the product, which is the
 * argument for it wearing the same instrument chrome as /login rather
 * than a plain card on the same backdrop.
 */
export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ readonly token?: string | string[] }>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (rawToken ?? '').trim();

  // If already logged in, no need to consume an invitation.
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
    <div className="w-full max-w-md">
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
              enrolment
            </span>
            <span className="telemetry text-text-faint">
              {token === '' ? 'link incomplete' : 'invite-only'}
            </span>
          </div>
          {token === '' ? (
            <>
              <h1 className="text-text-bright mb-1 text-base font-semibold">
                Invalid invitation link
              </h1>
              <p className="text-text-muted mb-4 text-xs leading-relaxed">
                The link you used is missing the invitation token. Open the email and click the
                button there, or paste the full URL including the{' '}
                <span className="font-mono">?token=…</span> parameter.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-text-bright mb-1 text-base font-semibold">
                Set up your seller account
              </h1>
              <p className="text-text-muted mb-5 text-xs leading-relaxed">
                Welcome to Skydrop. Fill in your company details below to complete registration.
              </p>
              <AcceptInvitationForm token={token} />
            </>
          )}
          <div aria-hidden className="glow-follow" />
        </div>
      </TiltPanel>

      <div className="boot-rise boot-rise-3 telemetry text-text-muted mt-5 text-center">
        already have an account?{' '}
        <a
          href="/login"
          className="hover:text-text-bright transition-colors"
          style={{ color: 'var(--sky)' }}
        >
          sign in
        </a>
      </div>
    </div>
  );
}
