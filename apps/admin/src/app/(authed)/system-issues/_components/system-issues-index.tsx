'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
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
import './system-issues.css';

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

/** How long it has been going on, said the way a person would. */
function since(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)} days ago`;
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

  const rows = list.data ?? [];
  const open = rows.filter((r) => r.resolvedAt === null);
  const urgent = open.filter((r) => r.severity === 'HIGH' || r.severity === 'CRITICAL').length;
  const unclaimed = open.filter((r) => r.acknowledgedAt === null).length;

  async function submitResolve(): Promise<void> {
    if (resolving === null) return;
    setError(null);
    try {
      await resolve.mutateAsync({ id: resolving.id, note: note.trim() });
      toast.success('Closed.');
      setResolving(null);
      setNote('');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[{ label: 'Operations' }, { label: 'Needs a person' }]}
        Link={Link}
        title="Needs a person"
        subtitle="Everything the system could not fix by itself. These do not break a screen — they stop figures moving — so they are collected here rather than left in a log."
        action={
          <div className="af-row">
            {mayResolve && (
              <Button
                variant="secondary"
                size="md"
                loading={announce.isPending}
                onClick={() => setConfirmAnnounce(true)}
                title="Only an issue nobody has been told about is announced. Pressing this twice sends nothing the second time."
              >
                Notify unannounced
              </Button>
            )}
            <Button variant="ghost" size="md" onClick={() => setIncludeResolved((v) => !v)}>
              {includeResolved ? 'Open only' : 'Show closed too'}
            </Button>
          </div>
        }
      />

      {announce.data !== undefined && (
        <Notice tone="good">
          <p>
            {announce.data.announced === 0
              ? `Nothing to send — all ${announce.data.open} open issue(s) had already been announced.`
              : `Told people about ${announce.data.announced} of ${announce.data.open} open issue(s); ${announce.data.alreadyAnnounced} had already been announced.`}
          </p>
        </Notice>
      )}

      {announce.isError && (
        <Notice tone="bad" role="alert">
          <p>{serverVerdict(announce.error)}</p>
        </Notice>
      )}

      {open.length > 0 && (
        <div className="af-kpis">
          <KpiCard label="Open" value={open.length} tone="info" />
          <KpiCard
            label="Nobody on it"
            value={unclaimed}
            tone={unclaimed > 0 ? 'pending' : 'neutral'}
          />
          <KpiCard label="Urgent" value={urgent} tone={urgent > 0 ? 'debit' : 'neutral'} />
        </div>
      )}

      {list.isLoading ? (
        <AfCard flush>
          <SkeletonRows rows={3} cols={3} label="Loading issues" />
        </AfCard>
      ) : list.isError ? (
        <ErrorState message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          tone="positive"
          title="Nothing needs you"
          description="No integration is stuck and no scheduled job is failing. This page fills itself when something breaks quietly — an empty one is the good outcome, not a missing feature."
        />
      ) : (
        <ul className="af-queue">
          {rows.map((r) => {
            const severity = severityOf(r.severity);
            return (
              <li
                key={r.id}
                className="af-qcard"
                data-severity={r.resolvedAt === null ? severity : undefined}
              >
                <div className="af-qcard__grid">
                  <div className="af-stack af-stack--tight">
                    <div className="si-head">
                      <span className="si-sev" data-sev={severity}>
                        <AlertTriangle size={12} aria-hidden />
                        {r.severity.charAt(0) + r.severity.slice(1).toLowerCase()}
                      </span>
                      <span className="si-title">{r.title}</span>
                    </div>
                    {/* The detail is the point of the card: it says what
                        to DO, written where the failure happened. */}
                    <p className="si-detail">{r.detail}</p>
                    {/* An issue about an order says which one; the link
                        saves copying the number into the search box. */}
                    {orderIdOf(r.metadata) !== null && (
                      <Link
                        href={`/orders/${orderIdOf(r.metadata) ?? ''}`}
                        className="af-link af-small af-inline-link"
                      >
                        Open the order
                      </Link>
                    )}
                    {/* A box that asked for no van (CUR-10 amendment #3).
                        A failed day is not retried by itself — the pickups
                        screen is where it is released and raised again. */}
                    {r.source === AUTO_PICKUP_SOURCE && canManagePickups && (
                      <Link href="/warehouse/pickups" className="af-link af-small af-inline-link">
                        Open pickups
                      </Link>
                    )}
                    <div className="si-meta">
                      <span className="af-faint sk-ident">{r.source}</span>
                      <MetaFact>
                        <Clock size={11} aria-hidden /> first seen {since(r.firstSeenAt)}
                      </MetaFact>
                      <span className="af-faint">last {since(r.lastSeenAt)}</span>
                      {/* Seen many times is a different problem from seen
                          once: it means it is not a blip. */}
                      {r.occurrenceCount > 1 && (
                        <MetaFact tone="warn">{r.occurrenceCount} times</MetaFact>
                      )}
                    </div>
                  </div>

                  <div className="af-qcard__actions si-actions">
                    {r.resolvedAt !== null ? (
                      <span className="af-faint">
                        closed {since(r.resolvedAt)}
                        {r.resolutionNote !== null && ` · ${r.resolutionNote}`}
                      </span>
                    ) : (
                      <>
                        {r.acknowledgedAt === null ? (
                          <AsyncButton
                            variant="secondary"
                            size="sm"
                            labels={{ idle: 'I’m on it', busy: 'Noting…', done: 'Noted' }}
                            disabled={ack.isPending}
                            onAction={async () => {
                              try {
                                await ack.mutateAsync(r.id);
                                toast.success('Noted as being looked at.');
                              } catch (e) {
                                toast.error(serverVerdict(e));
                                throw e;
                              }
                            }}
                          />
                        ) : (
                          <MetaFact tone="accent" dot>
                            being looked at · {since(r.acknowledgedAt)}
                          </MetaFact>
                        )}
                        {mayResolve && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setResolving(r);
                              setNote('');
                              setError(null);
                            }}
                          >
                            Close
                          </Button>
                        )}
                      </>
                    )}
                  </div>
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
        title="Close this issue"
        description="Say what was done. Several of these close themselves when the job next works — closing by hand is for the ones that needed you."
        footer={
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setResolving(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={resolve.isPending}
              disabled={note.trim().length < 5 || resolve.isPending}
              onClick={() => void submitResolve()}
            >
              Close
            </Button>
          </DialogFooter>
        }
      >
        <div className="af-form">
          {resolving !== null && <p className="af-title">{resolving.title}</p>}
          <TextArea
            label="What was done"
            requiredMark
            hint="At least a few words — it is the record."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
          {error !== null && <ErrorState title="Not closed" message={error} />}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmAnnounce}
        onOpenChange={setConfirmAnnounce}
        title="Notify people about unannounced issues?"
        entity={`${open.length} open issue(s)`}
        consequence="Everyone the issue's audience names is sent a notification for each open issue nobody has been told about yet; issues already announced are skipped."
        confirmLabel="Notify unannounced"
        onConfirm={() => {
          // The same fire-and-report request as before: the result or the
          // server's verdict appears under the header.
          announce.mutate();
        }}
      />
    </div>
  );
}
