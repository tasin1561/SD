import { Suspense, type ReactElement } from 'react';
import { getT } from '@/i18n/server';
import { AuthFrame } from '@/components/auth-frame';
import { ResetForm } from './_components/reset-form';

/**
 * Set a new password from the emailed link.
 *
 * This page was MISSING until 2026-10-14, and its absence was invisible
 * because the API never sent anybody here: `requestPasswordReset` built
 * every store user's reset link as `${resellerAppUrl}/auth/reset-password`,
 * so a sales person who asked to reset their password was emailed a link
 * to the STORE portal. Following it worked — the token is a store token
 * — and left them signed in at an origin where almost every page refuses
 * them, because `__Host-storeRefresh` is bound to the origin that set
 * it. The invitation path had the rule right from the start
 * (`invitationAppUrl`); the reset path never got it.
 */
export default async function ResetPasswordPage(): Promise<ReactElement> {
  const { t } = await getT();
  return (
    <AuthFrame title={t('auth.reset.title')} subtitle={t('auth.reset.subtitle')}>
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </AuthFrame>
  );
}
