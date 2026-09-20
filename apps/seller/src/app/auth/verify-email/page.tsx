import type { ReactElement } from 'react';
import { TiltPanel } from '@/lib/tilt';
import { VerifyEmailPanel } from './_components/verify-panel';

/**
 * Seller email verification, linked from the verification email as
 * `/auth/verify-email?token=…`.
 *
 * Same story as the reset page: the API had been mailing this URL and
 * nothing served it, so the link 404'd.
 */
export default async function SellerVerifyEmailPage({
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
              verification
            </span>
            <span className="telemetry text-text-faint">
              {token === '' ? 'link incomplete' : 'confirming'}
            </span>
          </div>
          <h1 className="text-text-bright mb-1 text-base font-semibold">Verify your email</h1>
          {token === '' ? (
            <>
              <p className="text-text-muted mb-4 text-xs leading-relaxed">
                The link is missing its verification token. Open the email again and use the button
                there rather than copying the address by hand.
              </p>
              <a
                href="/login"
                className="bg-accent-fill text-accent-fg hover:bg-accent-fill-hover inline-block rounded-[var(--radius-2)] px-3 py-1.5 text-sm font-medium transition-colors"
              >
                Back to sign in
              </a>
            </>
          ) : (
            <>
              <p className="text-text-muted mb-5 text-xs leading-relaxed">
                Confirming the address on your seller account.
              </p>
              <VerifyEmailPanel token={token} />
            </>
          )}
          <div aria-hidden className="glow-follow" />
        </div>
      </TiltPanel>
    </div>
  );
}
