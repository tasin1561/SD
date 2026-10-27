'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Eye, PenLine, ShieldOff, TriangleAlert } from 'lucide-react';
import { useToast } from '@skydrop/ui/app/toast';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Tabs } from '@skydrop/ui/app/tabs';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TBody, THead, Table, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import type { ImpersonationSessionSummary } from '@skydrop/api-client';
import { useEndImpersonation, useImpersonationSessions } from '@/lib/impersonation-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { AcAlert, AcHeader, AcPage, AcSection } from '../../settings/_components/ac-parts';
import { useT } from '@/i18n/client';

/** The server caps this at 200. A review screen, not an export. */
const LIMIT = 200;

type Filter = 'ALL' | 'LIVE' | 'ENDED';

/**
 * Every support session anybody has opened — the oversight half.
 *
 * ── WHY THIS SCREEN IS NOT ON `support.impersonate` ─────────────────
 * It is gated on `support.impersonate.review`, a DIFFERENT permission
 * from the one that opens a session, on purpose: a log only the people
 * using the feature can read is not oversight. The page is in
 * `page-access.ts` under the review key too, so the nav entry and the
 * route boundary agree and nobody is shown a link to a screen whose only
 * query refuses.
 *
 * ── WHAT A REVIEWER IS ACTUALLY LOOKING FOR ─────────────────────────
 * Two things, and the table is laid out for those rather than for the
 * data model. First: is anybody in somebody's account RIGHT NOW, and can
 * I end it. Live rows keep their colour and the End button while every
 * finished row fades, and the list refreshes itself, because the reason
 * to be on this screen at all is usually that one is running. Second:
 * was that session justified — which is the REASON column, printed
 * verbatim and never truncated. A clipped sentence is the one thing that
 * would make this screen pointless, so it wraps instead.
 *
 * The counts sit beside the reason for the same reason: "read-only, 12
 * requests" and "acting as them, 340 requests and 90 writes, to look at
 * one payout" are the shapes a reviewer is scanning for.
 *
 * ── THE FILTER IS CLIENT-SIDE, AND THAT IS DELIBERATE ───────────────
 * `GET /admin/impersonation` filters by staff member, seller and store —
 * not by whether a session is live. It answers with `live` on every row,
 * so splitting the one capped list here costs nothing and avoids a
 * second query that could disagree with the first about the same
 * session.
 */
export function ImpersonationReview(): ReactElement {
  const tr = useT();
  const canReview = usePermission('support.impersonate.review');
  // Ending one is gated on `support.impersonate` at the route, and on
  // `.review` in the service for somebody ELSE's session. So the button
  // is shown to anybody holding either and the server decides which of
  // the two this is — see the note on `useEndImpersonation`.
  const canEnd = usePermission('support.impersonate', 'support.impersonate.review');
  const [filter, setFilter] = useState<Filter>('ALL');
  const sessions = useImpersonationSessions({ limit: LIMIT });
  const end = useEndImpersonation();
  const toast = useToast();
  const [pendingEnd, setPendingEnd] = useState<ImpersonationSessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One tick a second, so every live row's "ends in 6m 12s" counts down
  // together instead of each row holding a timer of its own.
  const now = useNow(1_000);

  const all = sessions.data ?? [];
  // `isLive(s, now)` and not the server's `s.live`, which is a fact
  // about the moment the list was FETCHED and the list refetches every
  // 20 seconds while the clock ticks every second. Filtering on the
  // stale flag while the tab count and the row itself used the clock
  // meant a session passing its deadline while somebody watched sat in
  // neither tab for up to twenty seconds: "In there now" kept the row
  // but drew it faded with no End button, and "Finished" excluded it.
  // One reading of "live" per screen.
  const rows = useMemo(
    () =>
      filter === 'ALL'
        ? all
        : all.filter((s) => (filter === 'LIVE' ? isLive(s, now) : !isLive(s, now))),
    [all, filter, now],
  );
  const liveCount = all.filter((s) => isLive(s, now)).length;

  async function onEnd(session: ImpersonationSessionSummary): Promise<boolean> {
    setError(null);
    try {
      await end.mutateAsync({
        sessionId: session.id,
        reason: tr('impersonationImpersonationReview.endedFromTheReviewScreen'),
      });
      toast.success(
        tr('impersonationImpersonationReview.sessionEndedIsOutOf', {
          staffEmail: session.staffEmail,
          subjectLabel: session.subjectLabel,
        }),
      );
      setPendingEnd(null);
      return true;
    } catch (e) {
      setError(serverVerdict(e, tr('impersonationImpersonationReview.theSessionWasNotEnded')));
      return false;
    }
  }

  return (
    <AcPage>
      <AcHeader
        title={tr('impersonationImpersonationReview.supportSessions')}
        subtitle={tr('impersonationImpersonationReview.everyTimeAStaffMember')}
      />

      {!canReview && (
        <AcAlert
          tone="warn"
          message={tr('impersonationImpersonationReview.readingOtherPeopleSSupport')}
        />
      )}

      {error !== null && <AcAlert message={error} />}

      <Tabs
        label={tr('impersonationImpersonationReview.whichSessions')}
        size="sm"
        value={filter}
        onChange={(id) => setFilter(id === 'LIVE' ? 'LIVE' : id === 'ENDED' ? 'ENDED' : 'ALL')}
        items={[
          { id: 'ALL', label: tr('impersonationImpersonationReview.all') },
          {
            id: 'LIVE',
            label: tr('impersonationImpersonationReview.inThereNow'),
            ...(liveCount > 0 ? { count: liveCount } : {}),
          },
          { id: 'ENDED', label: tr('impersonationImpersonationReview.finished') },
        ]}
      />

      <AcSection
        title={tr('impersonationImpersonationReview.sessions')}
        {...(all.length === LIMIT
          ? {
              note: tr('impersonationImpersonationReview.theNewestSessionsTheServer', {
                limit: LIMIT,
              }),
            }
          : {})}
        flush
      >
        {sessions.isLoading ? (
          <SkeletonRows
            rows={5}
            cols={6}
            label={tr('impersonationImpersonationReview.loadingSupportSessions')}
          />
        ) : sessions.isError ? (
          <ErrorState
            message={serverVerdict(
              sessions.error,
              tr('impersonationImpersonationReview.theSessionListDidNot'),
            )}
            retry={() => void sessions.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            bare
            title={tr('impersonationImpersonationReview.noSupportSessions')}
            description={
              filter === 'LIVE'
                ? tr('impersonationImpersonationReview.nobodyIsInsideAClient')
                : tr('impersonationImpersonationReview.nobodyHasOpenedOneYet')
            }
          />
        ) : (
          <Table
            caption={tr('impersonationImpersonationReview.supportImpersonationSessionsNewestFirst')}
          >
            <THead>
              <Tr>
                <Th>{tr('impersonationImpersonationReview.who')}</Th>
                <Th>{tr('impersonationImpersonationReview.insideWhoseAccount')}</Th>
                <Th>{tr('impersonationImpersonationReview.why')}</Th>
                <Th>{tr('impersonationImpersonationReview.whenAndForHowLong')}</Th>
                <Th align="right">{tr('impersonationImpersonationReview.requests')}</Th>
                <Th align="right">{tr('impersonationImpersonationReview.actions')}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((s) => {
                const live = isLive(s, now);
                return (
                  <Tr key={s.id} className={live ? undefined : 'ac-row-off'}>
                    <Td>
                      <span className="ac-cell-main">{s.staffEmail}</span>
                      {live && (
                        <span className="ac-cell-sub ac-danger-text">
                          <TriangleAlert size={12} aria-hidden />{' '}
                          {tr('impersonationImpersonationReview.inThereNow')}
                        </span>
                      )}
                      {s.otpVerifiedAt === null && (
                        // Opened, code never answered — including the
                        // session five wrong codes closed. It did
                        // nothing, but a reviewer asking "who tried"
                        // wants to see it, so it is not hidden.
                        <span className="ac-cell-sub">
                          {tr('impersonationImpersonationReview.neverEnteredNoCodeWas')}
                        </span>
                      )}
                      {s.ipAddress !== null && (
                        <span className="ac-cell-sub sk-figure">
                          {tr('impersonationImpersonationReview.from', { ipAddress: s.ipAddress })}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="ac-inline">
                        <Link
                          href={
                            s.subject.kind === 'SELLER'
                              ? `/sellers/${s.subject.id}`
                              : `/reseller-stores/${s.subject.id}`
                          }
                          className="ac-link ac-cell-main"
                        >
                          {s.subjectLabel}
                        </Link>
                        <StatusChip
                          kind="neutral"
                          size="sm"
                          label={s.subject.kind === 'SELLER' ? 'client' : 'store'}
                        />
                      </span>
                    </Td>
                    <Td>
                      {/* VERBATIM, and never clipped. A truncated reason
                          is the one thing that would make this screen
                          worthless. */}
                      <p className="ac-quote">{s.reason}</p>
                      <span className="ac-cell-sub">
                        {s.mayWrite ? (
                          <span className="ac-danger-text">
                            <PenLine size={12} aria-hidden />{' '}
                            {tr('impersonationImpersonationReview.actingAsThem')}
                          </span>
                        ) : (
                          <>
                            <Eye size={12} aria-hidden />{' '}
                            {tr('impersonationImpersonationReview.readOnly')}
                          </>
                        )}
                      </span>
                      {s.endedReason !== null && (
                        <span className="ac-cell-sub">
                          {tr('impersonationImpersonationReview.onClosing', {
                            endedReason: s.endedReason,
                          })}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="sk-figure ac-faint">
                        {new Date(s.createdAt).toLocaleString()}
                      </span>
                      <span className="ac-cell-sub">{describeWindow(s, now)}</span>
                    </Td>
                    <Td align="right">
                      <span className="sk-figure">{s.requestCount}</span>
                      <span className="ac-cell-sub">
                        {s.writeCount === 0 ? (
                          tr('impersonationImpersonationReview.nothingChanged')
                        ) : (
                          <span className="ac-danger-text">
                            {s.writeCount} {s.writeCount === 1 ? 'write' : 'writes'}
                          </span>
                        )}
                      </span>
                    </Td>
                    <Td align="right">
                      {live && canEnd ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          icon={<ShieldOff size={14} />}
                          onClick={() => {
                            setError(null);
                            setPendingEnd(s);
                          }}
                        >
                          {tr('impersonationImpersonationReview.endNow')}
                        </Button>
                      ) : (
                        <span className="ac-faint">—</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </AcSection>

      <ConfirmDialog
        open={pendingEnd !== null}
        onOpenChange={(o) => {
          if (!o) setPendingEnd(null);
        }}
        title={tr('impersonationImpersonationReview.endThisSupportSessionNow')}
        entity={pendingEnd === null ? '' : `${pendingEnd.staffEmail} in ${pendingEnd.subjectLabel}`}
        consequence={tr('impersonationImpersonationReview.itStopsOnTheirVery')}
        confirmLabel={tr('impersonationImpersonationReview.endTheSession')}
        destructive
        error={error}
        onConfirm={async () => {
          if (pendingEnd === null) return;
          const ok = await onEnd(pendingEnd);
          if (!ok) throw new Error('not ended');
        }}
      />
    </AcPage>
  );
}

/**
 * Still inside somebody's account.
 *
 * The server answers `live` per row (verified, not ended, not past its
 * deadline) and that is the authority — but the clock is checked here as
 * well, because a row that was live when it was FETCHED stops being live
 * while somebody is looking at it, and a screen that went on offering
 * End for it would be offering an action against nothing.
 */
function isLive(s: ImpersonationSessionSummary, now: number): boolean {
  return s.live && s.endedAt === null && Date.parse(s.expiresAt) > now;
}

/** "running 4m 12s — ends in 5m 48s", or how long a finished one lasted. */
function describeWindow(s: ImpersonationSessionSummary, now: number): string {
  const opened = Date.parse(s.createdAt);
  if (isLive(s, now)) {
    return `running ${describeSpan(now - opened)} — ends in ${describeSpan(
      Date.parse(s.expiresAt) - now,
    )}`;
  }
  if (s.endedAt !== null)
    return `lasted ${describeSpan(Date.parse(s.endedAt) - opened)}, then ended`;
  // Never entered: how long it "ran" is not a fact about anything.
  if (s.otpVerifiedAt === null) return 'never started';
  // No end row and the window is past: it ran out rather than being
  // closed by anybody. Said that way round, because "ended" would imply
  // somebody decided.
  return `ran its full ${describeSpan(Date.parse(s.expiresAt) - opened)} and expired`;
}

/**
 * A span of milliseconds in the words a person would use: "4m 12s",
 * "1h 6m". Minutes and seconds, because these sessions are minutes long
 * and a reviewer reading "0.07 hours" has to do arithmetic.
 */
function describeSpan(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** `Date.now()`, re-read on an interval, so a countdown re-renders. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
