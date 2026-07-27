import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSellerSsrIdentity } from '@skydrop/auth/server';
import { apiOrigin } from '@/lib/api-origin';
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
    <div className="min-h-screen grid place-items-center bg-bg text-text-body p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="text-text-bright font-semibold text-lg tracking-tight">Skydrop</div>
          <div className="text-text-faint text-xs mt-0.5">Seller</div>
        </div>
        <div className="rounded-[7px] border border-border bg-surface p-6">
          {token === '' ? (
            <>
              <h1 className="text-text-bright text-base font-semibold mb-1">
                Invalid invitation link
              </h1>
              <p className="text-text-muted text-xs mb-4">
                The link you used is missing the invitation token. Open the email and click the
                button there, or paste the full URL including the{' '}
                <span className="font-mono">?token=…</span> parameter.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-text-bright text-base font-semibold mb-1">
                Set up your seller account
              </h1>
              <p className="text-text-muted text-xs mb-5">
                Welcome to Skydrop. Fill in your company details below to complete registration.
              </p>
              <AcceptInvitationForm token={token} />
            </>
          )}
        </div>
        <div className="text-text-faint text-xs text-center mt-4">
          Already have an account?{' '}
          <a href="/login" className="text-text-muted hover:text-text-body">
            Sign in
          </a>
        </div>
      </div>
    </div>
  );
}
