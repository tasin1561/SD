import type { ReactElement } from 'react';
import { ButtonLink } from '@skydrop/ui/app/button';
import { SignInCard } from '@skydrop/ui/app/sign-in';
import { VerifyEmailPanel } from './_components/verify-panel';
import { getT } from '@/i18n/server';

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
  const { t } = await getT();
  const params = await searchParams;
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (rawToken ?? '').trim();

  return token === '' ? (
    <SignInCard
      title={t('authVerifyEmailPage.verifyYourEmail')}
      note={t('authVerifyEmailPage.theLinkIsMissingIts')}
      footer={<a href="/login">{t('authVerifyEmailPage.backToSignIn')}</a>}
    >
      <ButtonLink href="/login" variant="primary" fullWidth>
        {t('authVerifyEmailPage.backToSignIn')}
      </ButtonLink>
    </SignInCard>
  ) : (
    <SignInCard
      title={t('authVerifyEmailPage.verifyYourEmail')}
      note={t('authVerifyEmailPage.confirmingTheAddressOnYour')}
      footer={<a href="/login">{t('authVerifyEmailPage.backToSignIn')}</a>}
    >
      <VerifyEmailPanel token={token} />
    </SignInCard>
  );
}
