import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { OtherPortals } from '@skydrop/ui/app/sign-in';
import { getT } from '@/i18n/server';
import { AuthFrame } from '@/components/auth-frame';

/**
 * How to get a sales login.
 *
 * WHY THIS PAGE EXISTS WITH NO FORM ON IT. A sales login is created by
 * the store the person sells for — the store invites them with the
 * `associate` role, and that invitation is the only way in. There is no
 * public endpoint and there must not be a form here suggesting one.
 *
 * The login page says "Use the login from the invitation your store
 * sent you", and somebody holding no invitation needs that sentence to
 * have a next step rather than a 404. The answer is one line long and
 * names who to ask.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('auth.signUp.title'), description: t('auth.signUp.description') };
}

export default async function SignUpPage(): Promise<ReactElement> {
  const { t, locale } = await getT();
  return (
    <AuthFrame
      title={t('auth.signUp.title')}
      subtitle={t('auth.signUp.subtitle')}
      footer={
        <>
          {t('auth.signUp.invited')} <a href="/login">{t('auth.signUp.signIn')}</a>
          {/*
            NOT wrapped in a <span>: `OtherPortals` renders a <nav>,
            and flow content inside phrasing content is invalid HTML.
            The parser closes the span, so the DOM never matches what
            React rendered — and FE-7 records what that costs: on a
            page with a hydration mismatch React 19 throws the server
            HTML away and resets <html>'s attributes to its server
            props, wiping the pinned theme. The footer slot is a <div>,
            so the nav belongs there directly.
          */}
          <OtherPortals
            self="associate"
            path="/sign-up"
            title={t('auth.signUp.otherPortal')}
            locale={locale}
          />
        </>
      }
    >
      <p className="sk-signin__lead">{t('auth.signUp.lead1')}</p>
      <p className="sk-signin__lead">{t('auth.signUp.lead2')}</p>
    </AuthFrame>
  );
}
