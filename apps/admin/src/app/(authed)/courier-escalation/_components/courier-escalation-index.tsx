'use client';

import { useState, type ReactElement } from 'react';
import { AlertTriangle, Copy, ExternalLink, Lock, PauseCircle, PlayCircle } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ErrorNote,
  Num,
  PageHeader,
  Section,
  Select,
  SkeletonRows,
  Stat,
  StatusBadge,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import {
  useClaimOutboxItem,
  useConfirmModeChange,
  useCourierChannel,
  useCourierOutbox,
  useMarkOutboxSent,
  usePauseCourierChannel,
  useReconcileOutbox,
  useReleaseOutboxItem,
  useRequestModeChange,
  useResumeCourierChannel,
  type OpsQueueItem,
  useCourierTaxonomy,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { EscalationTabs } from './escalation-tabs';
import Link from 'next/link';

/**
 * The courier escalation console — the MANUAL consumer of the outbox.
 *
 * ── DESIGNED FOR TWENTY SECONDS ──────────────────────────────────────
 * Everything needed to clear one item is on the row: who it is for, the
 * exact text with a copy button, and a deep link to the place it goes.
 * An operator who has to look up the ticket themselves spends most of
 * the twenty seconds on the lookup.
 *
 * ── "MARK SENT" IS NOT "DONE" ────────────────────────────────────────
 * It records SENT_UNCONFIRMED. The tick comes from a read-back and
 * nowhere else, which is why the button does not say Done and there is
 * no control anywhere on this page that sets CONFIRMED. If someone marks
 * an item sent without pasting a ticket id, the reconciler puts it back.
 */
export function CourierEscalationIndex(): ReactElement {
  const toast = useToast();
  const outbox = useCourierOutbox();
  const channel = useCourierChannel();
  const claim = useClaimOutboxItem();
  const markSent = useMarkOutboxSent();
  const release = useReleaseOutboxItem();
  const pause = usePauseCourierChannel();
  const resume = useResumeCourierChannel();

  const [ticketIds, setTicketIds] = useState<Record<string, string>>({});
  // FE-2: cosmetic. The server refuses regardless — this stops the page
  // offering a control whose request would only come back 403.
  const canWrite = usePermission('courier.ops.write');
  const reconcile = useReconcileOutbox();

  async function onReconcile(): Promise<void> {
    try {
      const r = await reconcile.mutateAsync();
      toast.success(
        r.readBackUnavailable
          ? // Without a read-back, "still unknown" is our own ignorance
            // rather than anything Delhivery told us — saying "0 confirmed"
            // would read as a finding.
            'Could not read state back from Delhivery, so nothing could be confirmed either way.'
          : `Examined ${r.examined}: ${r.confirmed} confirmed, ${r.returnedToQueue} back in the queue, ${r.stillUnknown} still unknown.`,
      );
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  const settings = channel.data?.settings;
  const counts = channel.data?.counts;
  const caps = channel.data?.capabilities;
  const noWriteChannel =
    caps !== undefined && caps['postComment'] === false && caps['raiseTicket'] === false;

  const copy = (text: string): void => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success('Copied'),
      () => toast.error('Could not copy'),
    );
  };

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      // FE-2: the server's verdict, verbatim.
      toast.error(serverVerdict(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Courier escalation"
        subtitle="Messages waiting to reach Delhivery, and the switch that decides who sends them."
      />
      <EscalationTabs />

      {noWriteChannel ? (
        <Card>
          <CardBody>
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">Delhivery has no ticket write API.</p>
                <p className="text-text-muted mt-1">
                  MCP is read-only and their notification emails do not accept replies, so nothing
                  here can be posted through an API — whatever the write mode says.
                </p>
                <p className="text-text-muted mt-1">
                  The BROWSER channel can. It drives their own “Raise a ticket” form, and it is what
                  actually sends these. It ships withholding every click:{' '}
                  <Link href="/courier-escalation/portal" className="text-accent hover:underline">
                    Portal worker
                  </Link>{' '}
                  is where it is turned on, and off. Until it is LIVE, every message here needs a
                  person.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Section
        title="Today"
        action={
          canWrite ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={reconcile.isPending}
              onClick={() => void onReconcile()}
            >
              {reconcile.isPending ? 'Reconciling…' : 'Reconcile now'}
            </Button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Waiting" value={<Num value={counts?.pending ?? 0} />} />
          <Stat label="In hand" value={<Num value={counts?.sending ?? 0} />} />
          <Stat label="Unconfirmed" value={<Num value={counts?.sentUnconfirmed ?? 0} />} />
          <Stat label="Confirmed today" value={<Num value={counts?.confirmedToday ?? 0} />} />
          <Stat label="Failed today" value={<Num value={counts?.failedToday ?? 0} />} />
        </div>
      </Section>

      <Section
        title="Write channel"
        subtitle="What the operator chose, and what the system currently thinks of its own health. Two different things."
      >
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <div className="text-text-muted text-xs uppercase tracking-wide">Mode</div>
                <div className="mt-1 font-medium">{settings?.writeMode ?? '—'}</div>
              </div>
              <div>
                <div className="text-text-muted text-xs uppercase tracking-wide">Health</div>
                <div className="mt-1">
                  {settings?.effectivelyPaused === true ? (
                    <StatusBadge kind="failed" label="Paused" />
                  ) : (
                    <StatusBadge kind="delivered" label="Running" />
                  )}
                </div>
              </div>
              <div className="grow">
                <div className="text-text-muted text-xs uppercase tracking-wide">
                  Auto categories
                </div>
                <div className="mt-1 text-sm">
                  {settings?.autoCategories.length === 0
                    ? 'None — nothing is actioned unattended'
                    : settings?.autoCategories.join(', ')}
                </div>
              </div>
              <div className="flex gap-2">
                {!canWrite ? null : settings?.effectivelyPaused === true ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void act(() => resume.mutateAsync(), 'Channel resumed')}
                  >
                    <PlayCircle size={14} /> Resume
                  </Button>
                ) : (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      void act(
                        () => pause.mutateAsync({ minutes: 60, reason: 'Paused from the console' }),
                        'Channel paused for 60 minutes',
                      )
                    }
                  >
                    <PauseCircle size={14} /> Pause
                  </Button>
                )}
              </div>
            </div>

            {settings?.pauseReason != null ? (
              <p className="text-text-muted mt-3 text-sm">Paused because: {settings.pauseReason}</p>
            ) : null}

            <div className="border-border mt-4 border-t pt-3">
              <div className="text-text-muted flex items-center gap-2 text-xs">
                <Lock size={13} />
                <span>
                  Human-only, always:{' '}
                  {(channel.data?.lockedCategoryLabels ?? []).join(' · ') || '—'}. These can never
                  be added to the auto list.
                </span>
              </div>
            </div>
          </CardBody>
        </Card>
        {canWrite ? <ModeSwitch /> : null}
      </Section>

      <Section title="Queue" subtitle="Oldest first. Claim an item to hold it for ten minutes.">
        {outbox.isLoading ? (
          <SkeletonRows rows={4} />
        ) : outbox.isError ? (
          <ErrorNote message={serverVerdict(outbox.error)} retry={() => void outbox.refetch()} />
        ) : (outbox.data ?? []).length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-text-muted text-sm">
                Nothing waiting. Messages arrive here when a seller raises an issue or an NDR
                re-attempt could not be confirmed.
              </p>
            </CardBody>
          </Card>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Parcel</Th>
                <Th>Message</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {(outbox.data ?? []).map((item: OpsQueueItem) => (
                <Tr key={item.id}>
                  <Td>
                    <div className="font-medium">{item.awbNumber ?? 'No AWB'}</div>
                    <div className="text-text-muted text-xs">{item.sellerName ?? '—'}</div>
                    <a
                      href={item.deepLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent mt-1 inline-flex items-center gap-1 text-xs"
                    >
                      {item.externalTicketId == null
                        ? 'Raise a ticket'
                        : `Ticket ${item.externalTicketId}`}
                      <ExternalLink size={11} />
                    </a>
                  </Td>
                  <Td>
                    {/* Verbatim. Never truncated in a way that changes it —
                        the operator pastes exactly this. */}
                    <pre className="bg-surface-2 max-w-md whitespace-pre-wrap rounded p-2 text-xs">
                      {item.body}
                    </pre>
                    <Button variant="ghost" size="sm" onClick={() => copy(item.body)}>
                      <Copy size={13} /> Copy
                    </Button>
                  </Td>
                  <Td>
                    <StatusBadge
                      kind={
                        item.status === 'SENT_UNCONFIRMED'
                          ? 'pending'
                          : item.status === 'SENDING'
                            ? 'in-transit'
                            : 'draft'
                      }
                      label={item.status.replace(/_/g, ' ').toLowerCase()}
                    />
                    {item.lastError != null ? (
                      <div className="text-text-muted mt-1 max-w-xs text-xs">{item.lastError}</div>
                    ) : null}
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-2">
                      {!canWrite ? (
                        <span className="text-text-muted text-xs">View only</span>
                      ) : null}
                      {canWrite && item.status === 'PENDING' ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() =>
                            void act(() => claim.mutateAsync(item.id), 'Claimed for 10 minutes')
                          }
                        >
                          Claim
                        </Button>
                      ) : null}
                      {canWrite && item.status === 'SENDING' ? (
                        <>
                          <input
                            className="sd-field"
                            placeholder="Ticket ID (paste it here)"
                            value={ticketIds[item.id] ?? ''}
                            onChange={(e) =>
                              setTicketIds((s) => ({ ...s, [item.id]: e.target.value }))
                            }
                          />
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() =>
                              void act(
                                () =>
                                  markSent.mutateAsync({
                                    itemId: item.id,
                                    ...(((ticketIds[item.id] ?? '').trim() === ''
                                      ? {}
                                      : {
                                          externalTicketId: (ticketIds[item.id] ?? '').trim(),
                                        }) as {
                                      externalTicketId?: string;
                                    }),
                                  }),
                                'Recorded as sent — awaiting read-back',
                              )
                            }
                          >
                            Mark sent
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void act(() => release.mutateAsync(item.id), 'Returned to the queue')
                            }
                          >
                            Give back
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}

/**
 * The two-step mode change.
 *
 * A code is mailed to the person asking, because widening the write
 * channel is what lets software post into a thread a customer reads —
 * and the mailbox is what proves the session belongs to them.
 */
function ModeSwitch(): ReactElement {
  const toast = useToast();
  const request = useRequestModeChange();
  const confirm = useConfirmModeChange();
  const [mode, setMode] = useState('MANUAL');
  const [reason, setReason] = useState('');
  /*
    WHICH categories may go unattended.

    Hardcoded to `[]` until now, with a comment saying the taxonomy had
    never been fetched so the server would refuse anything else. That
    stopped being true: the taxonomy is seeded, thirty categories with
    their human-only locks set, and the server accepts a list drawn from
    it. So AUTO mode was reachable and meant nothing — the worker claims
    only what is on this list, and the list could not be changed.

    Human-only categories are not offered at all. The server refuses them
    by name (`CATEGORY_IS_HUMAN_ONLY`) and would be right to, but a
    checkbox that exists only to be rejected is a worse way to say
    "never".
  */
  const taxonomy = useCourierTaxonomy();
  const selectable = (taxonomy.data ?? []).filter((c) => !c.isHumanOnly);
  const [auto, setAuto] = useState<string[]>([]);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');

  return (
    <Card>
      <CardBody>
        <h3 className="text-sm font-medium">Change the write mode</h3>
        {challengeId === null ? (
          <div className="mt-3 flex flex-col gap-3">
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="MANUAL">MANUAL — everything to this queue</option>
              <option value="SUPERVISED">SUPERVISED — prepared, held for approval</option>
              <option value="AUTO">AUTO — unattended, except locked categories</option>
            </Select>
            {mode === 'AUTO' ? (
              <div className="border-border rounded-md border p-3">
                <p className="text-text-strong text-xs font-medium">
                  Which categories may go unattended
                </p>
                <p className="text-text-muted mt-0.5 mb-2 text-xs">
                  Anything not ticked still goes to the queue for a person, even in AUTO.
                </p>
                <div className="max-h-48 space-y-1 overflow-auto">
                  {selectable.map((c) => (
                    <label key={c.externalId} className="flex items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={auto.includes(c.externalId)}
                        onChange={(e) =>
                          setAuto((prev) =>
                            e.target.checked
                              ? [...prev, c.externalId]
                              : prev.filter((x) => x !== c.externalId),
                          )
                        }
                      />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            <Textarea
              rows={2}
              placeholder="Why (at least 30 characters — this goes in the audit log)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  void (async () => {
                    try {
                      const r = await request.mutateAsync({
                        writeMode: mode,
                        // Only meaningful in AUTO; the other two modes
                        // route everything to a person regardless, and
                        // carrying a stale list into MANUAL would leave
                        // it armed for whenever somebody switched back.
                        autoCategories: mode === 'AUTO' ? auto : [],
                        reason,
                      });
                      setChallengeId(r.challengeId);
                      toast.success('Code sent to your email');
                    } catch (err) {
                      toast.error(serverVerdict(err));
                    }
                  })();
                }}
              >
                Send confirmation code
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-text-muted text-sm">
              A six-digit code was emailed to you. It expires in 10 minutes.
            </p>
            <input
              className="sd-field"
              placeholder="Six-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  void (async () => {
                    try {
                      await confirm.mutateAsync({ challengeId, code });
                      setChallengeId(null);
                      setCode('');
                      setReason('');
                      toast.success('Write mode changed');
                    } catch (err) {
                      toast.error(serverVerdict(err));
                    }
                  })();
                }}
              >
                Confirm
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setChallengeId(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
