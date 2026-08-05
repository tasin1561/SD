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
  SkeletonRows,
  Stat,
  StatusBadge,
  TBody,
  Table,
  Td,
  THead,
  Th,
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
  useReleaseOutboxItem,
  useRequestModeChange,
  useResumeCourierChannel,
  type OpsQueueItem,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { EscalationTabs } from './escalation-tabs';

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
                <p className="font-medium">Every message here needs a human.</p>
                <p className="text-text-muted mt-1">
                  Delhivery has no ticket write API — MCP is read-only and their notification emails
                  do not accept replies. Automation cannot post on your behalf yet, whatever the
                  write mode says. Changing the mode will not change that; it is ready for when they
                  ship write operations.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Section title="Today">
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
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');

  return (
    <Card>
      <CardBody>
        <h3 className="text-sm font-medium">Change the write mode</h3>
        {challengeId === null ? (
          <div className="mt-3 flex flex-col gap-3">
            <select className="sd-field" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="MANUAL">MANUAL — everything to this queue</option>
              <option value="SUPERVISED">SUPERVISED — prepared, held for approval</option>
              <option value="AUTO">AUTO — unattended, except locked categories</option>
            </select>
            <textarea
              className="sd-field"
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
                      // The auto list stays empty: the locks are enforced
                      // by category ID and the taxonomy has never been
                      // fetched, so the server refuses a non-empty list.
                      const r = await request.mutateAsync({
                        writeMode: mode,
                        autoCategories: [],
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
