import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { OtherPortals } from '@skydrop/ui/app/sign-in';
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
export const metadata: Metadata = {
  title: 'Get a sales login',
  description: 'How to get a Skydrop sales login from the store you sell for.',
};

export default function SignUpPage(): ReactElement {
  return (
    <AuthFrame
      title="Get a sales login"
      subtitle="Sales logins are created by the store you sell for."
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
          <OtherPortals self="associate" path="/sign-up" title="Looking for a different portal?" />
        </>
      }
    >
      <p className="sk-signin__lead">
        Ask whoever runs the store to invite you from their team screen. The invitation sets your
        password and opens the orders you place and the customers you sell to — your own, not the
        whole store&apos;s.
      </p>
      <p className="sk-signin__lead">
        They also set the price you sell each product at, so there is nothing for you to configure
        before your first order.
      </p>
    </AuthFrame>
  );
}
