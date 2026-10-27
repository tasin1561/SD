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
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';

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
  const t = useT();

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
            t('courierEscalationCourierEscalationIndex.couldNotReadStateBack')
          : t('courierEscalationCourierEscalationIndex.examinedConfirmedBackInThe', {
              examined: r.examined,
              confirmed: r.confirmed,
              returnedToQueue: r.returnedToQueue,
              stillUnknown: r.stillUnknown,
            }),
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
      () => toast.success(t('courierEscalationCourierEscalationIndex.copied')),
      () => toast.error(t('courierEscalationCourierEscalationIndex.couldNotCopy')),
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
        toast.success(t('courierEscalationCourierEscalationIndex.channelResumed'));
      } else {
        await pause.mutateAsync({
          minutes: 60,
          reason: t('courierEscalationCourierEscalationIndex.pausedFromTheConsole'),
        });
        toast.success(t('courierEscalationCourierEscalationIndex.channelPausedFor60Minutes'));
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
        breadcrumbs={[
          { label: t('courierEscalationCourierEscalationIndex.network') },
          { label: t('courierEscalationCourierEscalationIndex.courierEscalation') },
        ]}
        Link={Link}
        title={t('courierEscalationCourierEscalationIndex.courierEscalation')}
        subtitle={t('courierEscalationCourierEscalationIndex.messagesWaitingToReachDelhivery')}
      />
      <EscalationTabs />

      {noWriteChannel ? (
        <Notice
          tone="warn"
          title={t('courierEscalationCourierEscalationIndex.delhiveryHasNoTicketWrite')}
        >
          <p>{t('courierEscalationCourierEscalationIndex.mcpIsReadOnlyAnd')}</p>
          <p>
            {richMessage(t('courierEscalationCourierEscalationIndex.theBrowserChannelCanIt'), {
              link: (
                <Link href="/courier-escalation/portal" className="af-link">
                  {t('courierEscalationCourierEscalationIndex.portalWorker')}
                </Link>
              ),
            })}
          </p>
        </Notice>
      ) : null}

      <AfSection
        title={t('courierEscalationCourierEscalationIndex.today')}
        action={
          canWrite ? (
            <AsyncButton
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} />}
              labels={{
                idle: t('courierEscalationCourierEscalationIndex.reconcileNow'),
                busy: t('courierEscalationCourierEscalationIndex.reconciling'),
                done: t('courierEscalationCourierEscalationIndex.reconciled'),
                error: t('courierEscalationCourierEscalationIndex.notReconciled'),
              }}
              disabled={reconcile.isPending}
              onAction={onReconcile}
            />
          ) : undefined
        }
      >
        {/* The counts roll up once, when they first arrive. */}
        {counts === undefined ? (
          <SkeletonRows
            rows={1}
            cols={5}
            label={t('courierEscalationCourierEscalationIndex.loadingTodaySCounts')}
          />
        ) : (
          <div className="af-kpis">
            <KpiCard
              label={t('courierEscalationCourierEscalationIndex.waiting')}
              value={counts.pending}
              tone="pending"
            />
            <KpiCard
              label={t('courierEscalationCourierEscalationIndex.inHand')}
              value={counts.sending}
              tone="info"
            />
            <KpiCard
              label={t('courierEscalationCourierEscalationIndex.unconfirmed')}
              value={counts.sentUnconfirmed}
            />
            <KpiCard
              label={t('courierEscalationCourierEscalationIndex.confirmedToday')}
              value={counts.confirmedToday}
              tone="credit"
            />
            <KpiCard
              label={t('courierEscalationCourierEscalationIndex.failedToday')}
              value={counts.failedToday}
              tone="debit"
            />
          </div>
        )}
      </AfSection>

      <AfSection
        title={t('courierEscalationCourierEscalationIndex.writeChannel')}
        note={t('courierEscalationCourierEscalationIndex.whatTheOperatorChoseAnd')}
      >
        <AfCard>
          <div className="ce-channel">
            <div className="af-mini">
              <span className="af-mini__label">
                {t('courierEscalationCourierEscalationIndex.mode')}
              </span>
              <span className="af-mini__value">{settings?.writeMode ?? '—'}</span>
            </div>
            <div className="af-mini">
              <span className="af-mini__label">
                {t('courierEscalationCourierEscalationIndex.health')}
              </span>
              <span>
                {settings?.effectivelyPaused === true ? (
                  <StatusChip
                    kind="failed"
                    label={t('courierEscalationCourierEscalationIndex.paused')}
                  />
                ) : canSendAtAll ? (
                  <StatusChip
                    kind="delivered"
                    label={t('courierEscalationCourierEscalationIndex.running')}
                  />
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
                  <StatusChip
                    kind="pending"
                    label={t('courierEscalationCourierEscalationIndex.nothingCanSend')}
                  />
                )}
              </span>
            </div>
            <div className="af-mini ce-channel__wide">
              <span className="af-mini__label">
                {t('courierEscalationCourierEscalationIndex.autoCategories')}
              </span>
              <span className="af-body">
                {settings?.autoCategories.length === 0
                  ? t('courierEscalationCourierEscalationIndex.noneNothingIsActionedUnattended')
                  : settings?.autoCategories.join(', ')}
              </span>
              {!canSendAtAll && (settings?.autoCategories.length ?? 0) > 0 && (
                // The list still means something the day the browser
                // goes LIVE again, so it stays on screen — but read
                // beside a green "Running" it looked like a list of
                // things happening right now.
                <span className="af-small">
                  {t('courierEscalationCourierEscalationIndex.listedForWhenAWrite')}
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
                  {t('courierEscalationCourierEscalationIndex.resume')}
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
                  {t('courierEscalationCourierEscalationIndex.pause')}
                </Button>
              )}
            </div>
          </div>

          {settings?.pauseReason != null ? (
            <p className="af-muted">
              {t('courierEscalationCourierEscalationIndex.pausedBecause', {
                pauseReason: settings.pauseReason,
              })}
            </p>
          ) : null}

          <div className="af-divider">
            <p className="af-small ce-lock">
              <Lock size={13} aria-hidden />
              <span>
                {t('courierEscalationCourierEscalationIndex.humanOnlyAlwaysList', {
                  categories: (channel.data?.lockedCategoryLabels ?? []).join(' · ') || '—',
                })}
              </span>
            </p>
          </div>
        </AfCard>
        {canWrite ? <ModeSwitch /> : null}
      </AfSection>

      <AfSection
        title={t('courierEscalationCourierEscalationIndex.queue')}
        note={t('courierEscalationCourierEscalationIndex.oldestFirstClaimAnItem')}
      >
        {outbox.isLoading ? (
          <AfCard flush>
            <SkeletonRows
              rows={4}
              cols={4}
              label={t('courierEscalationCourierEscalationIndex.loadingTheSendQueue')}
            />
          </AfCard>
        ) : outbox.isError ? (
          <ErrorState message={serverVerdict(outbox.error)} retry={() => void outbox.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            tone="positive"
            title={t('courierEscalationCourierEscalationIndex.nothingWaiting')}
            description={t('courierEscalationCourierEscalationIndex.messagesArriveHereWhenA')}
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t('courierEscalationCourierEscalationIndex.parcel')}</Th>
                <Th>{t('courierEscalationCourierEscalationIndex.message')}</Th>
                <Th>{t('courierEscalationCourierEscalationIndex.status')}</Th>
                <Th>{t('courierEscalationCourierEscalationIndex.actions')}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((item: OpsQueueItem) => (
                <Tr key={item.id}>
                  <Td>
                    <div className="af-stack af-stack--tight">
                      <span className="af-strong sk-ident">
                        {item.awbNumber ?? t('courierEscalationCourierEscalationIndex.noAwb')}
                      </span>
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
                          ? t('courierEscalationCourierEscalationIndex.raiseATicket')
                          : t('courierEscalationCourierEscalationIndex.ticket', {
                              externalTicketId: item.externalTicketId,
                            })}
                        <ExternalLink size={11} aria-hidden />
                      </a>
                      {item.supportPanelUrl !== null && item.supportPanelUrl !== item.deepLink ? (
                        <a
                          href={item.supportPanelUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="af-link af-small ce-ext"
                        >
                          {t('courierEscalationCourierEscalationIndex.support', {
                            courierName: item.courierName,
                          })}
                          <ExternalLink size={11} aria-hidden />
                        </a>
                      ) : null}
                      <span className="af-small">
                        {item.supportEmail ??
                          t('courierEscalationCourierEscalationIndex.noSupportEmailSet', {
                            supportEmailSettingKey: item.supportEmailSettingKey,
                          })}
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
                          {t('courierEscalationCourierEscalationIndex.copy')}
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
                      {!canWrite ? (
                        <span className="af-small">
                          {t('courierEscalationCourierEscalationIndex.viewOnly')}
                        </span>
                      ) : null}
                      {canWrite && item.status === 'PENDING' ? (
                        <AsyncButton
                          variant="primary"
                          size="sm"
                          labels={{
                            idle: t('courierEscalationCourierEscalationIndex.claim'),
                            busy: t('courierEscalationCourierEscalationIndex.claiming'),
                            done: t('courierEscalationCourierEscalationIndex.claimed'),
                          }}
                          onAction={() =>
                            act(
                              () => claim.mutateAsync(item.id),
                              t('courierEscalationCourierEscalationIndex.claimedFor10Minutes'),
                            )
                          }
                        />
                      ) : null}
                      {canWrite && item.status === 'SENDING' ? (
                        <>
                          <TextField
                            label={t('courierEscalationCourierEscalationIndex.ticketId')}
                            placeholder={t(
                              'courierEscalationCourierEscalationIndex.ticketIdPasteItHere',
                            )}
                            value={ticketIds[item.id] ?? ''}
                            onChange={(e) =>
                              setTicketIds((s) => ({ ...s, [item.id]: e.target.value }))
                            }
                          />
                          <AsyncButton
                            variant="primary"
                            size="sm"
                            labels={{
                              idle: t('courierEscalationCourierEscalationIndex.markSent'),
                              busy: t('courierEscalationCourierEscalationIndex.recording'),
                              done: t('courierEscalationCourierEscalationIndex.recorded'),
                            }}
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
                                t(
                                  'courierEscalationCourierEscalationIndex.recordedAsSentAwaitingRead',
                                ),
                              )
                            }
                          />
                          <AsyncButton
                            variant="ghost"
                            size="sm"
                            labels={{
                              idle: t('courierEscalationCourierEscalationIndex.giveBack'),
                              busy: t('courierEscalationCourierEscalationIndex.returning'),
                              done: t('courierEscalationCourierEscalationIndex.returned'),
                            }}
                            onAction={() =>
                              act(
                                () => release.mutateAsync(item.id),
                                t('courierEscalationCourierEscalationIndex.returnedToTheQueue'),
                              )
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
          confirmChannel === 'resume'
            ? t('courierEscalationCourierEscalationIndex.resumeTheWriteChannel')
            : t('courierEscalationCourierEscalationIndex.pauseTheWriteChannel')
        }
        entity={t('courierEscalationCourierEscalationIndex.courierEscalationWriteChannel')}
        consequence={
          confirmChannel === 'resume'
            ? t('courierEscalationCourierEscalationIndex.messagesCanLeaveTheQueue')
            : t('courierEscalationCourierEscalationIndex.forTheNext60Minutes')
        }
        confirmLabel={
          confirmChannel === 'resume'
            ? t('courierEscalationCourierEscalationIndex.resume')
            : t('courierEscalationCourierEscalationIndex.pauseFor60Minutes')
        }
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
  const t = useT();
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
      toast.success(t('courierEscalationCourierEscalationIndex.codeSentToYourEmail'));
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
      toast.success(t('courierEscalationCourierEscalationIndex.writeModeChanged'));
    } catch (err) {
      toast.error(serverVerdict(err));
      throw err;
    }
  }

  return (
    <AfCard>
      <h3 className="af-card__title">
        {t('courierEscalationCourierEscalationIndex.changeTheWriteMode')}
      </h3>
      {challengeId === null ? (
        <div className="af-form">
          <Select
            label={t('courierEscalationCourierEscalationIndex.writeMode')}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="MANUAL">
              {t('courierEscalationCourierEscalationIndex.manualEverythingToThisQueue')}
            </option>
            <option value="SUPERVISED">
              {t('courierEscalationCourierEscalationIndex.supervisedPreparedHeldForApproval')}
            </option>
            <option value="AUTO">
              {t('courierEscalationCourierEscalationIndex.autoUnattendedExceptLockedCategories')}
            </option>
          </Select>
          {mode === 'AUTO' ? (
            <div className="af-inner">
              <p className="af-title">
                {t('courierEscalationCourierEscalationIndex.whichCategoriesMayGoUnattended')}
              </p>
              <p className="af-small">
                {t('courierEscalationCourierEscalationIndex.anythingNotTickedStillGoes')}
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
            label={t('courierEscalationCourierEscalationIndex.why')}
            rows={2}
            placeholder={t('courierEscalationCourierEscalationIndex.whyAtLeast30Characters')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div>
            <AsyncButton
              variant="primary"
              size="sm"
              labels={{
                idle: t('courierEscalationCourierEscalationIndex.sendConfirmationCode'),
                busy: t('courierEscalationCourierEscalationIndex.sending'),
                done: t('courierEscalationCourierEscalationIndex.codeSent'),
                error: t('courierEscalationCourierEscalationIndex.notSent'),
              }}
              onAction={sendCode}
            />
          </div>
        </div>
      ) : (
        <div className="af-form">
          <p className="af-muted">
            {t('courierEscalationCourierEscalationIndex.aSixDigitCodeWas')}
          </p>
          <SegmentedCode
            length={6}
            label={t('courierEscalationCourierEscalationIndex.sixDigitCode')}
            value={code}
            onChange={setCode}
            autoFocus
          />
          <div className="af-row">
            <AsyncButton
              variant="primary"
              size="sm"
              labels={{
                idle: t('courierEscalationCourierEscalationIndex.confirm'),
                busy: t('courierEscalationCourierEscalationIndex.confirming'),
                done: t('courierEscalationCourierEscalationIndex.changed'),
                error: t('courierEscalationCourierEscalationIndex.refused'),
              }}
              onAction={confirmCode}
            />
            <Button variant="ghost" size="sm" onClick={() => setChallengeId(null)}>
              {t('courierEscalationCourierEscalationIndex.cancel')}
            </Button>
          </div>
        </div>
      )}
    </AfCard>
  );
}
