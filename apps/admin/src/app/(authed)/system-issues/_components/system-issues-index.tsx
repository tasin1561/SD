'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorNote,
  FormField,
  Modal,
  ModalFooter,
  PageHeader,
  SkeletonRows,
  Stat,
  Textarea,
  Toolbar,
  useToast,
} from '@skydrop/ui/components';
import { AlertTriangle } from 'lucide-react';
import {
  useAcknowledgeIssue,
  useAnnounceUnnotifiedIssues,
  useResolveIssue,
  useSystemIssues,
  type SystemIssueView,
} from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';

/** Severity → the colour it deserves. */
function tone(sev: SystemIssueView['severity']): string {
  if (sev === 'CRITICAL' || sev === 'HIGH') return 'text-[var(--color-critical)]';
  if (sev === 'MEDIUM') return 'text-[var(--color-warning)]';
  return 'text-text-muted';
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
  const [includeResolved, setIncludeResolved] = useState(false);
  const list = useSystemIssues(includeResolved, usePermission('system.settings.view'));
  const ack = useAcknowledgeIssue();
  const resolve = useResolveIssue();
  const announce = useAnnounceUnnotifiedIssues();
  const toast = useToast();
  const [resolving, setResolving] = useState<SystemIssueView | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    <div>
      <PageHeader
        title="Needs a person"
        subtitle="Everything the system could not fix by itself. These do not break a screen — they stop figures moving — so they are collected here rather than left in a log."
        action={
          <div className="flex items-center gap-2">
            {mayResolve && (
              <Button
                variant="secondary"
                size="md"
                disabled={announce.isPending}
                onClick={() => announce.mutate()}
                title="Only an issue nobody has been told about is announced. Pressing this twice sends nothing the second time."
              >
                {announce.isPending ? 'Telling people…' : 'Notify unannounced'}
              </Button>
            )}
            <Button variant="ghost" size="md" onClick={() => setIncludeResolved((v) => !v)}>
              {includeResolved ? 'Open only' : 'Show closed too'}
            </Button>
          </div>
        }
      />

      {announce.data !== undefined && (
        <Card>
          <CardBody>
            <p className="text-sm">
              {announce.data.announced === 0
                ? `Nothing to send — all ${announce.data.open} open issue(s) had already been announced.`
                : `Told people about ${announce.data.announced} of ${announce.data.open} open issue(s); ${announce.data.alreadyAnnounced} had already been announced.`}
            </p>
          </CardBody>
        </Card>
      )}

      {announce.isError && (
        <Card>
          <CardBody>
            <p className="text-status-failed-fg text-sm">{serverVerdict(announce.error)}</p>
          </CardBody>
        </Card>
      )}

      {open.length > 0 && (
        <Toolbar>
          <Stat label="Open" value={String(open.length)} />
          <Stat
            label="Nobody on it"
            value={String(unclaimed)}
            tone={unclaimed > 0 ? 'warn' : 'neutral'}
          />
          <Stat label="Urgent" value={String(urgent)} tone={urgent > 0 ? 'bad' : 'neutral'} />
        </Toolbar>
      )}

      {list.isLoading ? (
        <Card>
          <SkeletonRows rows={3} />
        </Card>
      ) : list.isError ? (
        <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing needs you"
          description="No integration is stuck and no scheduled job is failing. This page fills itself when something breaks quietly — an empty one is the good outcome, not a missing feature."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <AlertTriangle
                        className={`h-4 w-4 shrink-0 ${tone(r.severity)}`}
                        aria-hidden
                      />
                      <span className={`text-sm font-medium ${tone(r.severity)}`}>{r.title}</span>
                    </div>
                    {/* The detail is the point of the card: it says what
                        to DO, written where the failure happened. */}
                    <p className="text-text-body mt-2 max-w-3xl text-xs whitespace-pre-line">
                      {r.detail}
                    </p>
                    <div className="text-text-faint mt-2 text-xs">
                      {r.source} · first seen {since(r.firstSeenAt)} · last {since(r.lastSeenAt)}
                      {/* Seen many times is a different problem from seen
                          once: it means it is not a blip. */}
                      {r.occurrenceCount > 1 && (
                        <span className="text-[var(--color-warning)]">
                          {' '}
                          · {r.occurrenceCount} times
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {r.resolvedAt !== null ? (
                      <span className="text-text-faint text-xs">
                        closed {since(r.resolvedAt)}
                        {r.resolutionNote !== null && ` · ${r.resolutionNote}`}
                      </span>
                    ) : (
                      <>
                        {r.acknowledgedAt === null ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={ack.isPending}
                            onClick={() =>
                              ack.mutate(r.id, {
                                onSuccess: () => toast.success('Noted as being looked at.'),
                                onError: (e) => toast.error(serverVerdict(e)),
                              })
                            }
                          >
                            I&rsquo;m on it
                          </Button>
                        ) : (
                          <span className="text-text-muted text-xs">
                            being looked at · {since(r.acknowledgedAt)}
                          </span>
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
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={resolving !== null}
        onOpenChange={(o) => {
          if (!o) setResolving(null);
        }}
        title="Close this issue"
        description="Say what was done. Several of these close themselves when the job next works — closing by hand is for the ones that needed you."
      >
        <FormField label="What was done" required hint="At least a few words — it is the record.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </FormField>
        {error !== null && <ErrorNote message={error} />}
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setResolving(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={note.trim().length < 5 || resolve.isPending}
            onClick={() => void submitResolve()}
          >
            {resolve.isPending ? 'Closing…' : 'Close'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
