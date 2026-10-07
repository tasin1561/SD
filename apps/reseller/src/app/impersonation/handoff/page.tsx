import type { ReactElement } from 'react';
import { SignInCard } from '@skydrop/ui/app/sign-in';
import { HandoffPanel } from './_components/handoff-panel';

/**
 * Where a support session ARRIVES. The admin console sends the browser
 * here once the one-time code is accepted, at
 * `/impersonation/handoff#token=…`, and the panel spends that token for
 * a session cookie.
 *
 * ── WHY THERE IS NOTHING TO READ HERE ───────────────────────────────
 * The token is in the URL's FRAGMENT, which is never sent to a server
 * and never written to an access log — that is the whole reason the API
 * puts it there. So this page cannot see it: only the browser can, and
 * everything that matters happens in the client panel below. Nothing
 * here should "helpfully" move the token into a query string to make
 * this page smarter, because that would undo the design.
 */
export default function ImpersonationHandoffPage(): ReactElement {
  return (
    <SignInCard
      title="Opening the support session"
      note="Spending the one-time link for a session inside the account. This takes a moment."
    >
      <HandoffPanel />
    </SignInCard>
  );
}
