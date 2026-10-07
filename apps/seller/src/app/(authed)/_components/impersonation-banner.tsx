'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Eye, PenLine, ShieldAlert, ShieldOff } from 'lucide-react';
import { useApiClient } from '@skydrop/auth/client';
import type { SellerMe } from '@skydrop/api-client';
import { serverVerdict } from '@/lib/server-verdict';
import './impersonation-banner.css';

/**
 * Where the way out lives — and it ENDS the session, it does not merely
 * forget it.
 *
 * `POST /auth/seller/impersonation/end` is `@Public` and
 * `@SkipImpersonationGate`, so it works from inside this origin with
 * nothing but the session cookie — which matters, because the browser in
 * here holds NO staff credential. The cookie is the credential: it names
 * one session and only its own staff member holds it. So the end row is
 * written here, from in here, by the person who was in there.
 *
 * ── WHY NOT `leave`, WHICH IS WHAT THIS USED TO CALL ────────────────
 * `leave` drops the cookie at this origin and leaves the session RUNNING
 * until its deadline. That is the wrong default by a distance: the staff
 * member is finished, and a session that reads as live on the review
 * screen while nobody is inside it is a false record in the one place
 * this feature exists to keep honest. (The comment that stood here
 * justified offering only `leave` on the grounds that ending needed the
 * staff guard — true before the cookie-authenticated route existed, and
 * left behind when it did.)
 *
 * `leave` survives as the FALLBACK, for the one case it is actually
 * right for: the cookie is dead — the session already timed out, or
 * somebody ended it from the console — so `/end` has no session to end,
 * and the person is otherwise stuck holding a cookie they cannot shed.
 * It skips the gate for exactly that reason, so it answers a dead cookie
 * cleanly.
 */
const END_PATH = '/api/auth/seller/impersonation/end';
const LEAVE_PATH = '/api/auth/seller/impersonation/leave';

/**
 * The bar a staff member sees while they are inside a seller's account.
 *
 * ── WHO THIS IS FOR ──────────────────────────────────────────────────
 * Not the seller. The seller never sees it, and not because it is hidden
 * from them: it renders off `identity.impersonation`, which only exists
 * on a session a staff member opened. A real seller's `/me` has no such
 * field, so there is no permission to check, no flag to get backwards,
 * and no way for this to appear on somebody's own account by accident.
 *
 * ── WHY IT IS THIS LOUD ──────────────────────────────────────────────
 * The risk this whole feature carries is one person: somebody who has
 * forgotten whose account they are in and starts fixing things. That
 * person is not reading a polite notice — they are three screens deep in
 * a wallet, scrolled past the top of the page, concentrating on the
 * problem. So: the seller's name in full (never "this account"), the
 * danger fill rather than a tint, a sticky bar that follows the scroll,
 * a red edge around the whole viewport that no scroll position can hide,
 * and the time left counting down so the session never feels open-ended.
 *
 * ── AND WHY IT CANNOT BE DISMISSED ───────────────────────────────────
 * There is no close control, deliberately. The bar is not an event ("you
 * started a session") that can be acknowledged — it is a CONDITION ("you
 * are still in there"), and a condition that can be clicked away is one
 * that will be, in the first minute, by the person most likely to need
 * it in the twentieth. The only control is the one that ends the
 * condition.
 *
 * ── WHAT IT DOES NOT CLAIM ───────────────────────────────────────────
 * It does not decide whether a write is allowed — the server refuses
 * every one in a read-only session, and refuses the forbidden list in
 * either (FE-2). "Read-only" here states what the server will do; it is
 * not a substitute for it doing it.
 */
export function ImpersonationBanner({ identity }: { identity: SellerMe }): ReactElement | null {
  const session = identity.impersonation ?? null;
  const client = useApiClient();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ticks only while there IS a session. The shell mounts this on every
  // page for every real user of the app, and a one-second interval
  // re-rendering the whole tree for ever, for nobody, is a cost this
  // feature has no right to impose on the people not using it.
  const now = useNow(session === null ? null : 1_000);

  if (session === null) return null;

  const remaining = Date.parse(session.expiresAt) - now;
  const over = remaining <= 0;

  async function leave(): Promise<void> {
    setError(null);
    setLeaving(true);
    try {
      await client.request<unknown>(END_PATH, { method: 'POST' });
    } catch {
      // `/end` found no live session to end — it already expired, or
      // somebody ended it on the console. The cookie in this browser is
      // then dead weight, and `/leave` is the route that sheds it
      // whatever state the session is in. Deliberately swallowed: the
      // staff member asked to get out, and the thing they asked for is
      // already true.
      try {
        await client.request<unknown>(LEAVE_PATH, { method: 'POST' });
      } catch (e) {
        // Shown in the bar rather than in a toast. A toast about failing
        // to get out of somebody's account disappears after four
        // seconds, and the fact that it failed is exactly the fact that
        // has to stay on screen.
        setError(serverVerdict(e, 'Could not end the session from this browser.'));
        setLeaving(false);
        return;
      }
    }
    // A HARD navigation: the point is to stop being in the account, and
    // the surest way to be sure of that is to stop being on a page of
    // it. The sign-in screen is this app's own, which is right — the
    // staff member goes back to the console the way they came.
    window.location.assign('/login');
  }

  return (
    <>
      <div className="imp-frame" aria-hidden />
      <div className="imp-bar" role="region" aria-label="Skydrop support session">
        <span className="imp-bar__icon" aria-hidden>
          <ShieldAlert size={20} />
        </span>

        <div className="imp-bar__says">
          <p className="imp-bar__lead">
            {over
              ? `This support session in ${identity.companyName}’s account has run out`
              : `You are inside ${identity.companyName}’s account`}
          </p>
          <p className="imp-bar__sub">
            {over
              ? 'Nothing on this screen will work any more. Close it, and open a new session from the console if you still need one.'
              : `Support session opened by ${session.staffEmail}. Everything you do here is recorded under their name and yours.`}
          </p>
        </div>

        <div className="imp-bar__facts">
          <span className="imp-bar__pill">
            {session.mayWrite ? (
              <>
                <PenLine size={12} aria-hidden /> Acting as them
              </>
            ) : (
              <>
                <Eye size={12} aria-hidden /> Read-only
              </>
            )}
          </span>
          {/* Not a live region: announcing a new second to a screen
              reader every second would make the page unusable. The
              sentence above already says what is happening. */}
          <span className="imp-bar__clock">
            {over ? 'ended' : `ends in ${describeRemaining(remaining)}`}
          </span>
        </div>

        <button
          type="button"
          className="imp-bar__end"
          onClick={() => void leave()}
          disabled={leaving}
          // Says exactly what the click does, because the label has to
          // be short and this one is not reversible: coming back needs a
          // fresh session, which means a fresh code.
          title="Ends the support session now and drops this browser out of the account. Coming back needs a new session from the console."
        >
          <ShieldOff size={16} aria-hidden />
          {leaving ? 'Ending…' : 'End session'}
        </button>

        {error !== null && (
          <p className="imp-bar__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}

/** "6m 12s" — minutes and seconds, because these sessions are minutes long. */
function describeRemaining(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/**
 * `Date.now()` on an interval, so the countdown actually counts. `null`
 * means do not tick at all — the hook still runs (it has to, it is a
 * hook) but sets no timer.
 */
function useNow(everyMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (everyMs === null) return undefined;
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
