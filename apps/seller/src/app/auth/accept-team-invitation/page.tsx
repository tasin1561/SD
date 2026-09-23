import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSellerSsrIdentity } from '@skydrop/auth/server';
import { SignInCard } from '@skydrop/ui/app/sign-in';
import { apiOrigin } from '@/lib/api-origin';
import { AcceptTeamInvitationForm } from './_components/accept-team-invitation-form';

/**
 * Public landing page for the seller-TEAM invitation email link. Reads
 * the token from ?token= and hands it to the client form, which collects
 * the invitee's password + display name and posts to
 * /auth/seller/accept-team-invitation. On 200 the API sets
 * __Host-sellerRefresh via Set-Cookie (passed through the proxy); we
 * hard-nav to /dashboard so the (authed) layout resolves identity.
 *
 * Already-logged-in sellers bounce to /dashboard — accepting on their
 * current session would lose it.
 */
export default async function AcceptTeamInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ readonly token?: string | string[] }>;
}): Promise<ReactElement> {
  const params = await searchParams;
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (rawToken ?? '').trim();

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

  const footer = (
    <p>
      Already have an account? <a href="/login">Sign in</a>
    </p>
  );

  if (token === '') {
    return (
      <SignInCard
        title="Invalid invitation link"
        note={
          <>
            The link you used is missing the invitation token. Open the email and click the button
            there, or paste the full URL including the <span className="font-mono">?token=…</span>{' '}
            parameter.
          </>
        }
        footer={footer}
      >
        {null}
      </SignInCard>
    );
  }

  return (
    <SignInCard
      title="Join the team"
      note="Set your name and password to accept the invitation."
      footer={footer}
    >
      <AcceptTeamInvitationForm token={token} />
    </SignInCard>
  );
}
