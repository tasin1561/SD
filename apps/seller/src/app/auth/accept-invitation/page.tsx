import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSellerSsrIdentity } from '@skydrop/auth/server';
import { SignInCard } from '@skydrop/ui/app/sign-in';
import { apiOrigin } from '@/lib/api-origin';
import { AcceptInvitationForm } from './_components/accept-invitation-form';
import { getT } from '@/i18n/server';
import { richMessage } from '@/i18n/rich';

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
 * argument for it wearing the same sign-in frame as /login (the layout's
 * `SignInFrame`) rather than a plain card on a different backdrop.
 */
export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ readonly token?: string | string[] }>;
}): Promise<ReactElement> {
  const { t } = await getT();
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

  const footer = (
    <p>
      {richMessage(t('authAccept.alreadyHaveAnAccount'), {
        a: <a href="/login">{t('authAccept.signIn')}</a>,
      })}
    </p>
  );

  if (token === '') {
    return (
      <SignInCard
        title={t('authAccept.invalidInvitationLink')}
        note={
          <>
            {richMessage(t('authAccept.theLinkYouUsed'), {
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
      title={t('authAccept.setUpYourSeller')}
      note={t('authAccept.welcomeToSkydropFill')}
      footer={footer}
    >
      <AcceptInvitationForm token={token} />
    </SignInCard>
  );
}
