'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { Copy, ExternalLink, Lock, PauseCircle, PlayCircle, RefreshCw } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { SegmentedCode } from '@skydrop/ui/app/segmented-code';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, Td, THead, Th, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
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
import { AfCard, AfSection, Notice } from '@/app/(authed)/system/_components/af-parts';
import { EscalationTabs } from './escalation-tabs';
import './escalation.css';

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
  // Pausing or resuming the write channel changes what leaves the queue
  // without a person, so each asks first. The request is unchanged.
  const [confirmChannel, setConfirmChannel] = useState<'pause' | 'resume' | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);

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
      throw err;
    }
  }

  const settings = channel.data?.settings;
  const counts = channel.data?.counts;
  const caps = channel.data?.capabilities;
  const noWriteChannel =
    caps !== undefined && caps['postComment'] === false && caps['raiseTicket'] === false;
  /*
    Can ANYTHING leave this queue without a person?

    Two independent ways in: an API write capability, or the browser
    channel being LIVE. Delhivery has no ticket write API at all, so
    today the browser is the only one — and while it is OFF or SHADOW
    the write mode is inert whatever it says.

    Derived rather than stored: it is a fact about the two switches, and
    a third setting saying the same thing is the drift CNS-2 and BIN-1
    exist to prevent.
  */
  const canSendAtAll = !noWriteChannel || settings?.portalMode === 'LIVE';

  const copy = (text: string): void => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success('Copied'),
      () => toast.error('Could not copy'),
    );
  };

  /** Runs the request, toasts the outcome; rejects on a refusal so the button says so. */
  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      // FE-2: the server's verdict, verbatim.
      toast.error(serverVerdict(err));
      throw err;
    }
  };

  async function onChannelConfirm(): Promise<void> {
    setChannelError(null);
    try {
      if (confirmChannel === 'resume') {
        await resume.mutateAsync();
        toast.success('Channel resumed');
      } else {
        await pause.mutateAsync({ minutes: 60, reason: 'Paused from the console' });
        toast.success('Channel paused for 60 minutes');
      }
    } catch (err) {
      // FE-2: shown verbatim in the dialog, which stays open to retry.
      setChannelError(serverVerdict(err));
      throw err;
    }
  }

  const rows = outbox.data ?? [];

  return (
    <div className="af-page">
      <PageHeader
        breadcrumbs={[{ label: 'Network' }, { label: 'Courier escalation' }]}
        Link={Link}
        title="Courier escalation"
        subtitle="Messages waiting to reach Delhivery, and the switch that decides who sends them."
      />
      <EscalationTabs />

      {noWriteChannel ? (
        <Notice tone="warn" title="Delhivery has no ticket write API.">
          <p>
            MCP is read-only and their notification emails do not accept replies, so nothing here
            can be posted through an API — whatever the write mode says.
          </p>
          <p>
            The browser channel can. It drives their own “Raise a ticket” form, and it is what
            actually sends these. It ships withholding every click:{' '}
            <Link href="/courier-escalation/portal" className="af-link">
              Portal worker
            </Link>{' '}
            is where it is turned on, and off. Until it is LIVE, every message here needs a person.
          </p>
        </Notice>
      ) : null}

      <AfSection
        title="Today"
        action={
          canWrite ? (
            <AsyncButton
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} />}
              labels={{
                idle: 'Reconcile now',
                busy: 'Reconciling…',
                done: 'Reconciled',
                error: 'Not reconciled',
              }}
              disabled={reconcile.isPending}
              onAction={onReconcile}
            />
          ) : undefined
        }
      >
        {/* The counts roll up once, when they first arrive. */}
        {counts === undefined ? (
          <SkeletonRows rows={1} cols={5} label="Loading today's counts" />
        ) : (
          <div className="af-kpis">
            <KpiCard label="Waiting" value={counts.pending} tone="pending" />
            <KpiCard label="In hand" value={counts.sending} tone="info" />
            <KpiCard label="Unconfirmed" value={counts.sentUnconfirmed} />
            <KpiCard label="Confirmed today" value={counts.confirmedToday} tone="credit" />
            <KpiCard label="Failed today" value={counts.failedToday} tone="debit" />
          </div>
        )}
      </AfSection>

      <AfSection
        title="Write channel"
        note="What the operator chose, and what the system currently thinks of its own health. Two different things."
      >
        <AfCard>
          <div className="ce-channel">
            <div className="af-mini">
              <span className="af-mini__label">Mode</span>
              <span className="af-mini__value">{settings?.writeMode ?? '—'}</span>
            </div>
            <div className="af-mini">
              <span className="af-mini__label">Health</span>
              <span>
                {settings?.effectivelyPaused === true ? (
                  <StatusChip kind="failed" label="Paused" />
                ) : canSendAtAll ? (
                  <StatusChip kind="delivered" label="Running" />
                ) : (
                  /*
                    "Running" was shown whenever the channel was not
                    PAUSED, which says nothing about whether anything
                    can actually be sent — and read as "automation is
                    on" beside a MODE of AUTO. It is the display that
                    prompted somebody to ask whether the tickets were
                    really manual.

                    Nothing can send when the courier exposes no write
                    capability AND the browser channel is not LIVE.
                    That is a true, checkable statement about the two
                    switches, so the chip makes it rather than leaving
                    it to be inferred.
                  */
                  <StatusChip kind="pending" label="Nothing can send" />
                )}
              </span>
            </div>
            <div className="af-mini ce-channel__wide">
              <span className="af-mini__label">Auto categories</span>
              <span className="af-body">
                {settings?.autoCategories.length === 0
                  ? 'None — nothing is actioned unattended'
                  : settings?.autoCategories.join(', ')}
              </span>
              {!canSendAtAll && (settings?.autoCategories.length ?? 0) > 0 && (
                // The list still means something the day the browser
                // goes LIVE again, so it stays on screen — but read
                // beside a green "Running" it looked like a list of
                // things happening right now.
                <span className="af-small">
                  Listed for when a write channel exists. None of it is acting today.
                </span>
              )}
            </div>
            <div className="af-row">
              {!canWrite ? null : settings?.effectivelyPaused === true ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<PlayCircle size={14} />}
                  onClick={() => {
                    setChannelError(null);
                    setConfirmChannel('resume');
                  }}
                >
                  Resume
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  icon={<PauseCircle size={14} />}
                  onClick={() => {
                    setChannelError(null);
                    setConfirmChannel('pause');
                  }}
                >
                  Pause
                </Button>
              )}
            </div>
          </div>

          {settings?.pauseReason != null ? (
            <p className="af-muted">Paused because: {settings.pauseReason}</p>
          ) : null}

          <div className="af-divider">
            <p className="af-small ce-lock">
              <Lock size={13} aria-hidden />
              <span>
                Human-only, always: {(channel.data?.lockedCategoryLabels ?? []).join(' · ') || '—'}.
                These can never be added to the auto list.
              </span>
            </p>
          </div>
        </AfCard>
        {canWrite ? <ModeSwitch /> : null}
      </AfSection>

      <AfSection title="Queue" note="Oldest first. Claim an item to hold it for ten minutes.">
        {outbox.isLoading ? (
          <AfCard flush>
            <SkeletonRows rows={4} cols={4} label="Loading the send queue" />
          </AfCard>
        ) : outbox.isError ? (
          <ErrorState message={serverVerdict(outbox.error)} retry={() => void outbox.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            tone="positive"
            title="Nothing waiting"
            description="Messages arrive here when a seller raises an issue or an NDR re-attempt could not be confirmed."
          />
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
              {rows.map((item: OpsQueueItem) => (
                <Tr key={item.id}>
                  <Td>
                    <div className="af-stack af-stack--tight">
                      <span className="af-strong sk-ident">{item.awbNumber ?? 'No AWB'}</span>
                      <span className="af-small">
                        {item.courierName} · {item.sellerName ?? '—'}
                      </span>
                      <a
                        href={item.deepLink}
                        target="_blank"
                        rel="noreferrer"
                        className="af-link af-small ce-ext"
                      >
                        {item.externalTicketId == null
                          ? 'Raise a ticket'
                          : `Ticket ${item.externalTicketId}`}
                        <ExternalLink size={11} aria-hidden />
                      </a>
                      {item.supportPanelUrl !== null && item.supportPanelUrl !== item.deepLink ? (
                        <a
                          href={item.supportPanelUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="af-link af-small ce-ext"
                        >
                          {item.courierName} support
                          <ExternalLink size={11} aria-hidden />
                        </a>
                      ) : null}
                      <span className="af-small">
                        {item.supportEmail ??
                          `No support email — set ${item.supportEmailSettingKey}`}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    {/* Verbatim. Never truncated in a way that changes it —
                        the operator pastes exactly this. */}
                    <div className="af-stack af-stack--tight ce-message">
                      <pre className="af-pre" data-dense="1">
                        {item.body}
                      </pre>
                      <div>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Copy size={13} />}
                          onClick={() => copy(item.body)}
                        >
                          Copy
                        </Button>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <div className="af-stack af-stack--tight">
                      <StatusChip
                        size="sm"
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
                        <span className="af-small ce-error-text">{item.lastError}</span>
                      ) : null}
                    </div>
                  </Td>
                  <Td>
                    <div className="af-stack af-stack--tight ce-actions">
                      {!canWrite ? <span className="af-small">View only</span> : null}
                      {canWrite && item.status === 'PENDING' ? (
                        <AsyncButton
                          variant="primary"
                          size="sm"
                          labels={{ idle: 'Claim', busy: 'Claiming…', done: 'Claimed' }}
                          onAction={() =>
                            act(() => claim.mutateAsync(item.id), 'Claimed for 10 minutes')
                          }
                        />
                      ) : null}
                      {canWrite && item.status === 'SENDING' ? (
                        <>
                          <TextField
                            label="Ticket ID"
                            placeholder="Ticket ID (paste it here)"
                            value={ticketIds[item.id] ?? ''}
                            onChange={(e) =>
                              setTicketIds((s) => ({ ...s, [item.id]: e.target.value }))
                            }
                          />
                          <AsyncButton
                            variant="primary"
                            size="sm"
                            labels={{ idle: 'Mark sent', busy: 'Recording…', done: 'Recorded' }}
                            onAction={() =>
                              act(
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
                          />
                          <AsyncButton
                            variant="ghost"
                            size="sm"
                            labels={{ idle: 'Give back', busy: 'Returning…', done: 'Returned' }}
                            onAction={() =>
                              act(() => release.mutateAsync(item.id), 'Returned to the queue')
                            }
                          />
                        </>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </AfSection>

      <ConfirmDialog
        open={confirmChannel !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmChannel(null);
        }}
        title={
          confirmChannel === 'resume' ? 'Resume the write channel?' : 'Pause the write channel?'
        }
        entity="Courier escalation write channel"
        consequence={
          confirmChannel === 'resume'
            ? 'Messages can leave the queue by the write mode again at once, without a person where the mode allows it.'
            : 'For the next 60 minutes nothing leaves the queue on its own; every message waits for a person.'
        }
        confirmLabel={confirmChannel === 'resume' ? 'Resume' : 'Pause for 60 minutes'}
        destructive={confirmChannel === 'pause'}
        error={channelError}
        onConfirm={onChannelConfirm}
      />
    </div>
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

  async function sendCode(): Promise<void> {
    try {
      const r = await request.mutateAsync({
        writeMode: mode,
        // Only meaningful in AUTO; the other two modes route everything
        // to a person regardless, and carrying a stale list into MANUAL
        // would leave it armed for whenever somebody switched back.
        autoCategories: mode === 'AUTO' ? auto : [],
        reason,
      });
      setChallengeId(r.challengeId);
      toast.success('Code sent to your email');
    } catch (err) {
      toast.error(serverVerdict(err));
      throw err;
    }
  }

  async function confirmCode(): Promise<void> {
    if (challengeId === null) return;
    try {
      await confirm.mutateAsync({ challengeId, code });
      setChallengeId(null);
      setCode('');
      setReason('');
      toast.success('Write mode changed');
    } catch (err) {
      toast.error(serverVerdict(err));
      throw err;
    }
  }

  return (
    <AfCard>
      <h3 className="af-card__title">Change the write mode</h3>
      {challengeId === null ? (
        <div className="af-form">
          <Select label="Write mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="MANUAL">MANUAL — everything to this queue</option>
            <option value="SUPERVISED">SUPERVISED — prepared, held for approval</option>
            <option value="AUTO">AUTO — unattended, except locked categories</option>
          </Select>
          {mode === 'AUTO' ? (
            <div className="af-inner">
              <p className="af-title">Which categories may go unattended</p>
              <p className="af-small">
                Anything not ticked still goes to the queue for a person, even in AUTO.
              </p>
              <div className="af-scroll af-stack af-stack--tight">
                {selectable.map((c) => (
                  <Checkbox
                    key={c.externalId}
                    label={c.label}
                    checked={auto.includes(c.externalId)}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      setAuto((prev) =>
                        on ? [...prev, c.externalId] : prev.filter((x) => x !== c.externalId),
                      );
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <TextArea
            label="Why"
            rows={2}
            placeholder="Why (at least 30 characters — this goes in the audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div>
            <AsyncButton
              variant="primary"
              size="sm"
              labels={{
                idle: 'Send confirmation code',
                busy: 'Sending…',
                done: 'Code sent',
                error: 'Not sent',
              }}
              onAction={sendCode}
            />
          </div>
        </div>
      ) : (
        <div className="af-form">
          <p className="af-muted">A six-digit code was emailed to you. It expires in 10 minutes.</p>
          <SegmentedCode
            length={6}
            label="Six-digit code"
            value={code}
            onChange={setCode}
            autoFocus
          />
          <div className="af-row">
            <AsyncButton
              variant="primary"
              size="sm"
              labels={{ idle: 'Confirm', busy: 'Confirming…', done: 'Changed', error: 'Refused' }}
              onAction={confirmCode}
            />
            <Button variant="ghost" size="sm" onClick={() => setChallengeId(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </AfCard>
  );
}
