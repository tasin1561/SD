import type { ReactElement } from 'react';
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
    <>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-text-bright font-semibold text-lg tracking-tight">Skydrop</div>
          <div className="text-text-faint text-xs mt-0.5">Seller</div>
        </div>
        <div className="rounded-[7px] border border-border bg-surface p-6">
          <h1 className="text-text-bright text-base font-semibold mb-1">Verify your email</h1>
          {token === '' ? (
            <>
              <p className="text-text-muted text-xs mb-4">
                The link is missing its verification token. Open the email again and use the button
                there rather than copying the address by hand.
              </p>
              <a
                href="/login"
                className="inline-block px-3 py-1.5 rounded-[5px] bg-accent text-accent-fg text-sm font-medium hover:bg-accent-hover transition-colors"
              >
                Back to sign in
              </a>
            </>
          ) : (
            <>
              <p className="text-text-muted text-xs mb-5">
                Confirming the address on your seller account.
              </p>
              <VerifyEmailPanel token={token} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
