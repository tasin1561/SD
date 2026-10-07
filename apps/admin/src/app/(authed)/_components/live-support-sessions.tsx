'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { useActiveImpersonations } from '@/lib/impersonation-hooks';
import './live-support-sessions.css';

/**
 * "Somebody is inside a seller's account RIGHT NOW", on every page of
 * the console.
 *
 * ── WHY THIS IS NOT JUST A COLUMN ON `/impersonation` ───────────────
 * The risk this whole feature carries is that nobody notices. The
 * review screen answers "who has been in there" perfectly well, and a
 * reviewer who is looking at it is already not the problem — the
 * problem is the hour nobody opens it. So the indicator lives in the
 * header, beside the bell, and is reachable from wherever a reviewer
 * happens to be.
 *
 * ── AND WHY IT IS `/active` AND NOT THE REVIEW LIST'S OWN COUNT ─────
 * That screen counts the live rows in the page it fetched, which is
 * capped (200 server-side, fewer by default). A live session older than
 * the page falls off the list and out of the count — and the session
 * most worth noticing is precisely the one that has been running
 * longest. `/active` asks the question directly: verified, not ended,
 * not past its deadline.
 *
 * ── IT RENDERS NOTHING WHEN THERE IS NOTHING ────────────────────────
 * No zero state, no grey chip. A persistent indicator that says "0" all
 * week is one people stop seeing, which is the one failure this cannot
 * afford. The hook self-gates on `support.impersonate.review`, so for
 * anybody who is not a reviewer it fires no request and this returns
 * null — the same reason the nav link is filtered for them.
 */
export function LiveSupportSessions(): ReactElement | null {
  const active = useActiveImpersonations();
  const count = active.data?.length ?? 0;
  if (count === 0) return null;

  return (
    <Link
      href="/impersonation"
      className="live-imp"
      // The accessible name carries the number, because the digit in the
      // chip is the whole message and "1" on its own says nothing.
      aria-label={`${count} support ${count === 1 ? 'session' : 'sessions'} running — review`}
      title={
        count === 1
          ? 'A staff member is inside a seller’s or store’s account right now.'
          : `${count} staff members are inside a seller’s or store’s account right now.`
      }
    >
      <ShieldAlert size={14} aria-hidden />
      <span className="live-imp__n" aria-hidden>
        {count}
      </span>
    </Link>
  );
}
