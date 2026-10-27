import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { ButtonLink } from '@skydrop/ui/app/button';
import { OtherPortals } from '@skydrop/ui/app/sign-in';
import { getT } from '@/i18n/server';
import { AuthFrame } from '@/components/auth-frame';

/**
 * How to get a store login.
 *
 * WHY THIS PAGE EXISTS WITH NO FORM ON IT. Nothing here can create a
 * store login: a store is opened by the client whose stock it sells
 * (or by Skydrop and then approved by that client), and the first user
 * is invited as part of opening it. There is no public endpoint, and a
 * form here pretending otherwise would be a dead end dressed as a door.
 *
 * But /sign-up is what a person types, and the login page says "Use the
 * login from your store invitation" — which has to have an answer for
 * somebody holding no invitation. Without this page that answer is a
 * 404.
 *
 * It also carries the way out for a case that really happens: a
 * business that wants to SHIP its own stock, not resell somebody
 * else's, and typed this address because a person said "Skydrop
 * member". They are offered the public invite request rather than left
 * reading instructions for a thing they do not want.
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
            self="store"
            path="/sign-up"
            title={t('auth.signUp.otherPortal')}
            locale={locale}
          />
        </>
      }
    >
      <p className="sk-signin__lead">{t('auth.signUp.lead1')}</p>
      <p className="sk-signin__lead">{t('auth.signUp.lead2')}</p>
      <ButtonLink
        variant="secondary"
        size="lg"
        fullWidth
        href="https://skydrop.global/request-invite"
      >
        {t('auth.signUp.requestClient')}
      </ButtonLink>
    </AuthFrame>
  );
}
