import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSellerSsrIdentity } from '@skydrop/auth/server';
import { SignInCard } from '@skydrop/ui/app/sign-in';
import { apiOrigin } from '@/lib/api-origin';
import { AcceptTeamInvitationForm } from './_components/accept-team-invitation-form';
import { getT } from '@/i18n/server';
import { richMessage } from '@/i18n/rich';

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
  const { t } = await getT();
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
      {richMessage(t('authAcceptTeam.alreadyHaveAnAccount'), {
        a: <a href="/login">{t('authAcceptTeam.signIn')}</a>,
      })}
    </p>
  );

  if (token === '') {
    return (
      <SignInCard
        title={t('authAcceptTeam.invalidInvitationLink')}
        note={
          <>
            {richMessage(t('authAcceptTeam.theLinkYouUsed'), {
              span: <span className="font-mono">?token=…</span>,
            })}
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
      title={t('authAcceptTeam.joinTheTeam')}
      note={t('authAcceptTeam.setYourNameAnd')}
      footer={footer}
    >
      <AcceptTeamInvitationForm token={token} />
    </SignInCard>
  );
}
