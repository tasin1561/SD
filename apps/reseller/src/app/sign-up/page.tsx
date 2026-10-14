import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { ButtonLink } from '@skydrop/ui/app/button';
import { OtherPortals } from '@skydrop/ui/app/sign-in';
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
export const metadata: Metadata = {
  title: 'Get a store login',
  description: 'How to get a login for a Skydrop member store.',
};

export default function SignUpPage(): ReactElement {
  return (
    <AuthFrame
      title="Get a store login"
      subtitle="Store logins are created by the business whose stock you sell."
      footer={
        <>
          Already invited? The invitation email carries your link. <a href="/login">Sign in</a>
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
          <OtherPortals self="store" path="/sign-up" title="Looking for a different portal?" />
        </>
      }
    >
      <p className="sk-signin__lead">
        Ask them to invite you from their Skydrop account. The invitation sets your password and
        opens your store&apos;s own portal — your catalogue, your orders and your wallet, under your
        own name.
      </p>
      <p className="sk-signin__lead">
        Wanting to send your own stock to India instead? That is a client account, and it starts
        here.
      </p>
      <ButtonLink
        variant="secondary"
        size="lg"
        fullWidth
        href="https://skydrop.global/request-invite"
      >
        Request a client invite
      </ButtonLink>
    </AuthFrame>
  );
}
