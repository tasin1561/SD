import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { ButtonLink } from '@skydrop/ui/app/button';
import { OtherPortals, SignInCard } from '@skydrop/ui/app/sign-in';

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
export const metadata: Metadata = {
  title: 'Get a client account',
  description: 'How to get a Skydrop client account.',
};

export default function SignUpPage(): ReactElement {
  return (
    <SignInCard
      title="Get a client account"
      note="Skydrop accounts are opened by invitation, so that every client is set up with their warehouse space, courier accounts and terms before their first parcel moves."
      footer={
        <>
          <p>
            Already invited? The invitation email carries your link. <a href="/login">Sign in</a>
          </p>
          <OtherPortals self="client" path="/sign-up" title="Looking for a different portal?" />
        </>
      }
    >
      <div className="sk-signin__form">
        <p className="sk-signin__lead">
          Tell us what you sell and where you ship it, and we will come back to you.
        </p>
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
          Request an invite
        </ButtonLink>
      </div>
    </SignInCard>
  );
}
