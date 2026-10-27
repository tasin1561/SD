import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { ButtonLink } from '@skydrop/ui/app/button';
import { OtherPortals, SignInCard } from '@skydrop/ui/app/sign-in';
import { getT } from '@/i18n/server';
import { richMessage } from '@/i18n/rich';

/**
 * How to get a client account.
 *
 * WHY THIS PAGE EXISTS WITH NO FORM ON IT. Skydrop is invite-only, so
 * there is no endpoint that creates an account from this screen and
 * there must not be a form here pretending otherwise. But "/sign-up" is
 * what a person types or guesses, and what a login page has to be able
 * to answer when somebody reads "Use the credentials from your Skydrop
 * invitation" and has no invitation. Without this page that question
 * ends at a 404.
 *
 * So it leads with the ONE real action — the public invite request on
 * the marketing site, which posts to the only open endpoint we have
 * (`/api/public/invite-leads`) — and then says plainly where an
 * invitation already sent would be. The chooser is last and points at
 * the other consoles' own version of this page, because somebody asking
 * "how do I get in" from the wrong console wants that console's answer
 * to the same question, not its sign-in form.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('signUp.metaTitle'), description: t('signUp.metaDescription') };
}

export default async function SignUpPage(): Promise<ReactElement> {
  const { t, locale } = await getT();
  return (
    <SignInCard
      title={t('signUp.getAClientAccount')}
      note={t('signUp.skydropAccountsAreOpened')}
      footer={
        <>
          <p>
            {richMessage(t('signUp.alreadyInvitedTheInvitation'), {
              a: <a href="/login">{t('signUp.signIn')}</a>,
            })}
          </p>
          <OtherPortals
            self="client"
            locale={locale}
            path="/sign-up"
            title={t('signUp.lookingForADifferent')}
          />
        </>
      }
    >
      <div className="sk-signin__form">
        <p className="sk-signin__lead">{t('signUp.tellUsWhatYou')}</p>
        {/*
          An ordinary link, deliberately NOT a submit-shaped control with
          a busy state: it navigates, and a navigation fires immediately,
          so animating a result we never learn would be a lie. Press
          feedback only.
        */}
        <ButtonLink
          variant="primary"
          size="lg"
          fullWidth
          href="https://skydrop.global/request-invite"
        >
          {t('signUp.requestAnInvite')}
        </ButtonLink>
      </div>
    </SignInCard>
  );
}
