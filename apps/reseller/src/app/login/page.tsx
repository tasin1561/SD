import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveStoreSsrIdentity } from '@skydrop/auth/server';
import { OtherPortals } from '@skydrop/ui/app/sign-in';
import { apiOrigin } from '@/lib/api-origin';
import { getT } from '@/i18n/server';
import { AuthFrame } from '@/components/auth-frame';
import { LoginForm } from './_components/login-form';
import './_components/rd-auth.css';

/**
 * Sign in. A visitor who already holds a valid `__Host-storeRefresh`
 * cookie is sent straight to the dashboard — resolved read-only through
 * /me (FE-4), never a refresh.
 */
export default async function LoginPage(): Promise<ReactElement> {
  const { t, locale } = await getT();
  const cookieValue = (await cookies()).get('__Host-storeRefresh')?.value ?? '';
  if (cookieValue) {
    const result = await resolveStoreSsrIdentity({
      apiOrigin: apiOrigin(),
      identityKind: 'store',
      cookieValue,
    });
    if (result.state === 'authenticated') redirect('/dashboard');
  }

  return (
    <AuthFrame
      title={t('auth.signIn.title')}
      subtitle={t('auth.signIn.subtitle')}
      footer={
        <>
          {t('auth.signIn.forgot')} <a href="/password-reset">{t('auth.signIn.resetIt')}</a>
          <span className="rd-auth-alt">
            {t('auth.signIn.noLogin')} <a href="/sign-up">{t('auth.signIn.howToGet')}</a>
          </span>
          {/*
           * The way OUT to the other consoles, from the shared directory
           * in `@skydrop/ui/app/sign-in`. It replaced a single
           * hand-written link to the seller portal: the consoles look
           * near-identical now that this one wears the corridor console,
           * and only the hostname tells them apart, so somebody who
           * bookmarked the wrong one or was forwarded a colleague's link
           * meets a form that will never accept them and says "invalid
           * credentials" — true and useless. One link was not enough:
           * a sales person who landed here could only be sent to the
           * client portal, which is further from where they belong.
           */}
          <OtherPortals self="store" locale={locale} />
        </>
      }
    >
      <LoginForm />
    </AuthFrame>
  );
}
