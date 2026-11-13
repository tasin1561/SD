'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { AlertOctagon, AlertTriangle, CheckCircle2, Clock, Info, Repeat } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useAcknowledgeIssue,
  useAnnounceUnnotifiedIssues,
  useResolveIssue,
  useSystemIssues,
  type SystemIssueView,
} from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { AfCard, MetaFact, Notice } from '@/app/(authed)/system/_components/af-parts';
import { InfoButton } from '@/components/easy/info-button';
import { ListenButton } from '@/components/easy/listen-button';
import './system-issues.css';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

/** The order an issue is about, when its metadata names one. */
/** The `source` every `auto-pickup:<courier>:<warehouse>` issue carries
 *  (courier-pickup.service). The list does not return the dedupe key. */
const AUTO_PICKUP_SOURCE = 'courier-pickup.auto';

function orderIdOf(metadata: unknown): string | null {
  if (metadata === null || typeof metadata !== 'object') return null;
  const v = (metadata as { orderId?: unknown }).orderId;
  return typeof v === 'string' && v !== '' ? v : null;
}

/** Severity → the queue card's rule and chip. Colour is never alone: the word is on the chip. */
function severityOf(sev: SystemIssueView['severity']): 'critical' | 'high' | 'medium' | 'low' {
  if (sev === 'CRITICAL') return 'critical';
  if (sev === 'HIGH') return 'high';
  if (sev === 'MEDIUM') return 'medium';
  return 'low';
}

/** The severity as a word in the reader's language. Colour is never the only signal. */
const SEVERITY_WORD: Readonly<Record<ReturnType<typeof severityOf>, MessageKey>> = {
  critical: 'ezIssues.sevCritical',
  high: 'ezIssues.sevHigh',
  medium: 'ezIssues.sevMedium',
  low: 'ezIssues.sevLow',
};

/** Which open issues the list is narrowed to. `all` also shows closed ones when asked for. */
type IssueFilter = 'all' | 'unclaimed' | 'urgent';

function isUrgent(r: SystemIssueView): boolean {
  return r.severity === 'HIGH' || r.severity === 'CRITICAL';
}

/** How long it has been going on, said the way a person would. */
function since(t: Translate<MessageKey>, iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return t('systemIssuesSystemIssuesIndex.mAgo', { mins });
  const hours = Math.floor(mins / 60);
  if (hours < 48) return t('systemIssuesSystemIssuesIndex.hAgo', { hours });
  return t('systemIssuesSystemIssuesIndex.daysAgo', { value: Math.floor(hours / 24) });
}

/**
 * Everything the system cannot fix by itself.
 *
 * ── WHY THIS PAGE EXISTS ─────────────────────────────────────────────
 * The failures that matter most are the quiet ones. A courier portal
 * asking for an OTP, a nightly cost sync that stopped logging in, a
 * credential that expired — none of them breaks a screen. The figures
 * just stop moving, and somebody notices weeks later that a margin looks
 * wrong.
 *
 * So anything that needs a person says so HERE, in one list, and stays
 * until a person closes it.
 *
 * ── WHY IT IS CARDS AND NOT A TABLE ──────────────────────────────────
 * Each row is a paragraph somebody has to read and act on — what broke,
 * what it means, what to do. A grid would truncate exactly the part that
 * makes it actionable. There should also never be many of these; a long
 * list is itself the alarm.
 *
 * ── ACKNOWLEDGING IS NOT RESOLVING ───────────────────────────────────
 * Acknowledging says somebody is on it, so two people do not chase the
 * same thing. It does NOT close the issue — the problem is still there.
 * Several of these close themselves the moment the job works again.
 */
export function SystemIssuesIndex(): ReactElement {
  const t = useT();

  const mayResolve = usePermission('system.settings.manage');
  const canManagePickups = usePermission('courier.pickups.manage');
  const [includeResolved, setIncludeResolved] = useState(false);
  const list = useSystemIssues(includeResolved, usePermission('system.settings.view'));
  const ack = useAcknowledgeIssue();
  const resolve = useResolveIssue();
  const announce = useAnnounceUnnotifiedIssues();
  const toast = useToast();
  const [resolving, setResolving] = useState<SystemIssueView | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Announcing tells people about issues they were never told of, so it
  // asks first. It sends the same request; a second press sends nothing.
  const [confirmAnnounce, setConfirmAnnounce] = useState(false);
  // Pressing a count narrows the list to those issues; pressing it again shows everything.
  const [filter, setFilter] = useState<IssueFilter>('all');

  const rows = list.data ?? [];
  const open = rows.filter((r) => r.resolvedAt === null);
  const urgent = open.filter(isUrgent).length;
  const unclaimed = open.filter((r) => r.acknowledgedAt === null).length;
  const shown =
    filter === 'urgent'
      ? open.filter(isUrgent)
      : filter === 'unclaimed'
        ? open.filter((r) => r.acknowledgedAt === null)
        : rows;
  const counts: ReadonlyArray<{
    readonly key: IssueFilter;
    readonly label: string;
    readonly value: number;
    readonly tone: 'info' | 'warn' | 'bad' | undefined;
  }> = [
    {
      key: 'all',
      label: t('systemIssuesSystemIssuesIndex.open'),
      value: open.length,
      tone: 'info',
    },
    {
      key: 'unclaimed',
      label: t('systemIssuesSystemIssuesIndex.nobodyOnIt'),
      value: unclaimed,
      tone: unclaimed > 0 ? 'warn' : undefined,
    },
    {
      key: 'urgent',
      label: t('systemIssuesSystemIssuesIndex.urgent'),
      value: urgent,
      tone: urgent > 0 ? 'bad' : undefined,
    },
  ];

  async function submitResolve(): Promise<void> {
    if (resolving === null) return;
    setError(null);
    try {
      await resolve.mutateAsync({ id: resolving.id, note: note.trim() });
      toast.success(t('systemIssuesSystemIssuesIndex.closed'));
      setResolving(null);
      setNote('');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[
          { label: t('systemIssuesSystemIssuesIndex.operations') },
          { label: t('systemIssuesSystemIssuesIndex.needsAPerson') },
        ]}
        Link={Link}
        title={
          <span className="ez-titled">
            {t('systemIssuesSystemIssuesIndex.needsAPerson')}
            <InfoButton
              title={t('systemIssuesSystemIssuesIndex.needsAPerson')}
              text={t('systemIssuesSystemIssuesIndex.everythingTheSystemCouldNot')}
            />
          </span>
        }
        action={
          <div className="af-row">
            {mayResolve && (
              <span className="ez-titled">
                <Button
                  variant="secondary"
                  size="md"
                  loading={announce.isPending}
                  onClick={() => setConfirmAnnounce(true)}
                  title={t('systemIssuesSystemIssuesIndex.onlyAnIssueNobodyHas')}
                >
                  {t('systemIssuesSystemIssuesIndex.notifyUnannounced')}
                </Button>
                <InfoButton
                  title={t('systemIssuesSystemIssuesIndex.notifyUnannounced')}
                  text={t('systemIssuesSystemIssuesIndex.onlyAnIssueNobodyHas')}
                />
              </span>
            )}
            <Button variant="ghost" size="md" onClick={() => setIncludeResolved((v) => !v)}>
              {includeResolved
                ? t('systemIssuesSystemIssuesIndex.openOnly')
                : t('systemIssuesSystemIssuesIndex.showClosedToo')}
            </Button>
          </div>
        }
      />

      {announce.data !== undefined && (
        <Notice tone="good">
          <p>
            {announce.data.announced === 0
              ? t('systemIssuesSystemIssuesIndex.nothingToSendAllOpen', {
                  open: announce.data.open,
                })
              : t('systemIssuesSystemIssuesIndex.toldPeopleAboutOfOpen', {
                  announced: announce.data.announced,
                  open: announce.data.open,
                  alreadyAnnounced: announce.data.alreadyAnnounced,
                })}
          </p>
        </Notice>
      )}

      {announce.isError && (
        <Notice tone="bad" role="alert">
          <p>{serverVerdict(announce.error)}</p>
        </Notice>
      )}

      {open.length > 0 && (
        <div className="si-counts" role="group" aria-label={t('ezIssues.show')}>
          {counts.map((c) => (
            <button
              key={c.key}
              type="button"
              className="si-count"
              data-tone={c.tone}
              aria-pressed={filter === c.key}
              onClick={() => setFilter((f) => (f === c.key ? 'all' : c.key))}
            >
              <span className="si-count__num">{c.value}</span>
              <span className="si-count__label">{c.label}</span>
            </button>
          ))}
          <InfoButton title={t('ezIssues.countsTitle')} text={t('ezIssues.countsText')} />
        </div>
      )}

      {list.isLoading ? (
        <AfCard flush>
          <SkeletonRows
            rows={3}
            cols={3}
            label={t('systemIssuesSystemIssuesIndex.loadingIssues')}
          />
        </AfCard>
      ) : list.isError ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          tone="positive"
          title={t('systemIssuesSystemIssuesIndex.nothingNeedsYou')}
          description={t('systemIssuesSystemIssuesIndex.noIntegrationIsStuckAnd')}
        />
      ) : shown.length === 0 ? (
        // A count was pressed and nothing matches it any more (somebody
        // took the last one). Say so and offer the way back.
        <div className="si-none">
          <p>{t('ezIssues.noneInFilter')}</p>
          <Button variant="secondary" size="md" onClick={() => setFilter('all')}>
            {t('ezIssues.showAllOpen')}
          </Button>
        </div>
      ) : (
        <ul className="si-list">
          {shown.map((r) => {
            const severity = severityOf(r.severity);
            const closed = r.resolvedAt !== null;
            const SevIcon = closed
              ? CheckCircle2
              : severity === 'critical'
                ? AlertOctagon
                : severity === 'low'
                  ? Info
                  : AlertTriangle;
            const orderId = orderIdOf(r.metadata);
            return (
              <li key={r.id} className="si-row" data-severity={closed ? 'closed' : severity}>
                <span className="si-row__icon" aria-hidden>
                  <SevIcon size={20} />
                </span>

                <div className="si-row__main">
                  <div className="si-head">
                    <span className="si-title">{r.title}</span>
                    <span className="si-sev" data-sev={closed ? 'closed' : severity}>
                      {closed ? t('ezIssues.closedLabel') : t(SEVERITY_WORD[severity])}
                    </span>
                  </div>
                  {/* The detail is the point of the row: it says what
                      to DO, written where the failure happened. */}
                  <p className="si-detail">{r.detail}</p>
                  <div className="si-meta">
                    <MetaFact>
                      <Clock size={13} aria-hidden />{' '}
                      {t('systemIssuesSystemIssuesIndex.firstSeen', {
                        value: since(t, r.firstSeenAt),
                      })}
                    </MetaFact>
                    {/* Seen many times is a different problem from seen
                        once: it means it is not a blip. */}
                    {r.occurrenceCount > 1 && (
                      <MetaFact tone="warn">
                        <Repeat size={13} aria-hidden />{' '}
                        {t('systemIssuesSystemIssuesIndex.times', {
                          occurrenceCount: r.occurrenceCount,
                        })}
                      </MetaFact>
                    )}
                    {/* The technical source and the last sighting are
                        still here — one press away, off the page. */}
                    <InfoButton
                      title={t('ezIssues.details')}
                      facts={[
                        { label: t('ezIssues.cameFrom'), value: r.source },
                        { label: t('ezIssues.firstSeenLabel'), value: since(t, r.firstSeenAt) },
                        { label: t('ezIssues.lastSeenLabel'), value: since(t, r.lastSeenAt) },
                        {
                          label: t('ezIssues.timesLabel'),
                          value: t('systemIssuesSystemIssuesIndex.times', {
                            occurrenceCount: r.occurrenceCount,
                          }),
                        },
                      ]}
                    />
                    {/* The issue is written by the server, in English,
                        whatever language the console is in. */}
                    <ListenButton text={`${r.title}. ${r.detail}`} lang="en" />
                  </div>
                  {/* An issue about an order says which one; the link
                      saves copying the number into the search box. */}
                  {(orderId !== null || (r.source === AUTO_PICKUP_SOURCE && canManagePickups)) && (
                    <div className="si-links">
                      {orderId !== null && (
                        <Link href={`/orders/${orderId}`} className="af-link si-link">
                          {t('systemIssuesSystemIssuesIndex.openTheOrder')}
                        </Link>
                      )}
                      {/* A box that asked for no van (CUR-10 amendment #3).
                          A failed day is not retried by itself — the pickups
                          screen is where it is released and raised again. */}
                      {r.source === AUTO_PICKUP_SOURCE && canManagePickups && (
                        <Link href="/warehouse/pickups" className="af-link si-link">
                          {t('systemIssuesSystemIssuesIndex.openPickups')}
                        </Link>
                      )}
                    </div>
                  )}
                </div>

                <div className="si-row__actions">
                  {closed ? (
                    <span className="af-faint">
                      {t('systemIssuesSystemIssuesIndex.closedAgo', {
                        ago: since(t, r.resolvedAt ?? r.lastSeenAt),
                      })}
                      {r.resolutionNote !== null && ` · ${r.resolutionNote}`}
                    </span>
                  ) : (
                    <>
                      {r.acknowledgedAt === null ? (
                        <span className="ez-titled">
                          <AsyncButton
                            variant="secondary"
                            size="md"
                            labels={{
                              idle: t('systemIssuesSystemIssuesIndex.iMOnIt'),
                              busy: t('systemIssuesSystemIssuesIndex.noting'),
                              done: t('systemIssuesSystemIssuesIndex.noted'),
                            }}
                            disabled={ack.isPending}
                            onAction={async () => {
                              try {
                                await ack.mutateAsync(r.id);
                                toast.success(
                                  t('systemIssuesSystemIssuesIndex.notedAsBeingLookedAt'),
                                );
                              } catch (e) {
                                toast.error(serverVerdict(e));
                                throw e;
                              }
                            }}
                          />
                          <InfoButton
                            title={t('ezIssues.onItTitle')}
                            text={t('ezIssues.onItText')}
                          />
                        </span>
                      ) : (
                        <MetaFact tone="accent" dot>
                          {t('systemIssuesSystemIssuesIndex.beingLookedAt', {
                            value: since(t, r.acknowledgedAt),
                          })}
                        </MetaFact>
                      )}
                      {mayResolve && (
                        <Button
                          variant="ghost"
                          size="md"
                          onClick={() => {
                            setResolving(r);
                            setNote('');
                            setError(null);
                          }}
                        >
                          {t('systemIssuesSystemIssuesIndex.close')}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={resolving !== null}
        onOpenChange={(o) => {
          if (!o) setResolving(null);
        }}
        title={t('systemIssuesSystemIssuesIndex.closeThisIssue')}
        description={t('systemIssuesSystemIssuesIndex.sayWhatWasDoneSeveral')}
        footer={
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setResolving(null)}>
              {t('systemIssuesSystemIssuesIndex.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={resolve.isPending}
              disabled={note.trim().length < 5 || resolve.isPending}
              onClick={() => void submitResolve()}
            >
              {t('systemIssuesSystemIssuesIndex.close')}
            </Button>
          </DialogFooter>
        }
      >
        <div className="af-form">
          {resolving !== null && <p className="af-title">{resolving.title}</p>}
          <TextArea
            label={t('systemIssuesSystemIssuesIndex.whatWasDone')}
            requiredMark
            hint={t('systemIssuesSystemIssuesIndex.atLeastAFewWords')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
          {error !== null && (
            <ErrorState title={t('systemIssuesSystemIssuesIndex.notClosed')} message={error} />
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmAnnounce}
        onOpenChange={setConfirmAnnounce}
        title={t('systemIssuesSystemIssuesIndex.notifyPeopleAboutUnannouncedIssues')}
        entity={t('systemIssuesSystemIssuesIndex.openIssueS', { length: open.length })}
        consequence={t('systemIssuesSystemIssuesIndex.everyoneTheIssueSAudience')}
        confirmLabel={t('systemIssuesSystemIssuesIndex.notifyUnannounced')}
        onConfirm={() => {
          // The same fire-and-report request as before: the result or the
          // server's verdict appears under the header.
          announce.mutate();
        }}
      />
    </div>
  );
}
