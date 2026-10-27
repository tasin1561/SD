'use client';

import Link from 'next/link';
import { Fragment, useState, type ReactElement, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Layers, Lock, ShieldAlert } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Accordion, AccordionItem } from '@skydrop/ui/app/accordion';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { DateField } from '@skydrop/ui/app/date-field';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { ParachuteProgress } from '@skydrop/ui/app/parachute-progress';
import { Select } from '@skydrop/ui/app/select';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TBody, THead, Table, TableEmpty, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { usePnlLineItems, type PnlReportView } from '@/lib/ops-hooks';
import { istDateLabel } from '@/lib/ist-day';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import {
  useBackfillPnlClose,
  useClosePnlMonth,
  useGodModeRelockPnl,
  useLockPnlPermanently,
  usePnlCarryForwardRows,
  usePnlFrozenRows,
  usePnlMonth,
  usePnlNightlyJobs,
  usePnlPeriods,
  type BackfillResultView,
  type CarriedGroupView,
  type CarryForwardFilter,
  type PnlMonthStatus,
  type PnlVersionKindView,
} from '@/lib/pnl-carry-forward-hooks';
import { LinkButton, MoCard, MoSection, Notice } from '../../../treasury/_components/money-parts';
import '../../_components/pnl.css';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

/**
 * The carry-forward P&L (PNL-CF-1).
 *
 * Costs keep arriving for weeks after a parcel leaves — a courier bills a
 * return, a claim is settled, an expense is typed with last month's date.
 * On /pnl a past month keeps moving to reflect that. Here a month is
 * FROZEN once it closes (06:00 IST on the 1st, after the nightly courier
 * jobs), and anything that changes it later is carried into the month
 * that is open when it is found — so a reported month says the same thing
 * next quarter as it did the day it closed, and nothing is lost.
 */
export function CarryForwardIndex(): ReactElement {
  const t = useT();

  const periods = usePnlPeriods();
  const [picked, setPicked] = useState<string | null>(null);
  // Closing is irreversible and has its own permission; the page is
  // readable by anyone who can read /pnl. Cosmetic only — the API decides.
  const canClose = usePermission('money.pnl.close');
  // Restating a permanently locked month is its own, stronger permission.
  const canGodMode = usePermission('money.pnl.god_mode');
  const month = picked ?? periods.data?.currentMonth ?? null;

  return (
    <div className="mo-page">
      <PageHeader
        title={t('pnlCarryForwardCarryForwardIndex.carryForwardPL')}
        subtitle={t('pnlCarryForwardCarryForwardIndex.eachMonthFrozenOnceIt')}
        action={
          <LinkButton href="/pnl" variant="ghost" size="sm">
            {t('pnlCarryForwardCarryForwardIndex.livePL')}
          </LinkButton>
        }
      />

      {periods.isLoading ? (
        <PageSkeleton />
      ) : periods.isError || periods.data === undefined ? (
        <ErrorState
          message={
            periods.error?.message ?? t('pnlCarryForwardCarryForwardIndex.couldNotLoadTheMonths')
          }
          retry={() => void periods.refetch()}
        />
      ) : (
        <>
          <MoCard>
            <div className="pl-month-pick">
              <Select
                label={t('pnlCarryForwardCarryForwardIndex.month')}
                value={month ?? ''}
                onChange={(e) => setPicked(e.target.value)}
              >
                {periods.data.months.map((m) => (
                  <option key={m.month} value={m.month}>
                    {m.name} — {statusWord(t, m.status)}
                    {m.lockState === 'PROVISIONAL' ? ' (provisional)' : ''}
                  </option>
                ))}
              </Select>
            </div>
          </MoCard>
          {month !== null && (
            <MonthView key={month} month={month} canClose={canClose} canGodMode={canGodMode} />
          )}
          {canClose && <BackfillPanel />}
        </>
      )}
    </div>
  );
}

/** Loading: the three figures and the lines, as shapes. */
function PageSkeleton(): ReactElement {
  const t = useT();
  return (
    <div className="mo-stack">
      <div className="mo-kpis">
        <Skeleton height={112} rounded="md" />
        <Skeleton height={112} rounded="md" />
        <Skeleton height={112} rounded="md" />
      </div>
      <SkeletonRows rows={5} cols={4} label={t('pnlCarryForwardCarryForwardIndex.loading')} />
    </div>
  );
}

/** A section heading over content that is not itself one card (a list of lines). */
function PlainSection({
  title,
  children,
}: {
  readonly title: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="mo-section">
      <SectionHeading title={title} />
      {children}
    </section>
  );
}

function statusWord(t: Translate<MessageKey>, s: PnlMonthStatus): string {
  switch (s) {
    case 'CLOSED':
      return 'closed';
    case 'OPEN':
      return 'open';
    case 'AWAITING_CLOSE':
      return t('pnlCarryForwardCarryForwardIndex.notClosedYet');
    default: {
      const unreachable: never = s;
      return unreachable;
    }
  }
}

/** An IST date and time, whatever zone the browser is in. */
function istDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** "−x" for "x", without going through a float. */
function negate(amount: string): string {
  if (/^-?0(\.0+)?$/.test(amount)) return amount.replace('-', '');
  return amount.startsWith('-') ? amount.slice(1) : `-${amount}`;
}

/** A signed change: gains with a +, losses with a −. */
function Delta({ amount }: { readonly amount: string }): ReactElement {
  const n = Number(amount);
  return (
    <Money
      amount={amount}
      currency="INR"
      convert={false}
      direction={n > 0 ? 'credit' : n < 0 ? 'debit' : 'neutral'}
    />
  );
}

function MonthView({
  month,
  canClose,
  canGodMode,
}: {
  readonly month: string;
  readonly canClose: boolean;
  readonly canGodMode: boolean;
}): ReactElement {
  const t = useT();

  // A locked version other than the current one, opened read-only.
  const [version, setVersion] = useState<number | null>(null);
  const q = usePnlMonth(month, version);
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || q.data === undefined) {
    return (
      <ErrorState
        message={q.error?.message ?? t('pnlCarryForwardCarryForwardIndex.couldNotLoadThisMonth')}
        retry={() => void q.refetch()}
      />
    );
  }
  const v = q.data;
  const closed = v.status === 'CLOSED';
  const carriedCount = v.carriedIn.reduce((n, g) => n + g.count, 0);
  const currentVersion = v.versions.find((x) => x.current)?.version ?? null;
  const viewingOld = closed && v.shownVersion !== null && v.shownVersion !== currentVersion;

  return (
    <div className="mo-stack">
      {v.closed !== null ? (
        <MoCard>
          <p className="pl-closed">
            <Lock size={16} aria-hidden />
            <StatusChip
              size="sm"
              kind={v.lockState === 'PROVISIONAL' ? 'pending' : 'confirmed'}
              label={
                v.lockState === 'PROVISIONAL'
                  ? t('pnlCarryForwardCarryForwardIndex.provisional')
                  : t('pnlCarryForwardCarryForwardIndex.lockedPermanently')
              }
            />
            <span>
              {t('pnlCarryForwardCarryForwardIndex.closedOn', {
                value: istDateTime(v.closed.at),
                value2:
                  v.closed.by === null
                    ? t('pnlCarryForwardCarryForwardIndex.byTheScheduledClose')
                    : `by ${v.closed.by}`,
                value3:
                  v.closed.kind === 'BACKFILL'
                    ? t('pnlCarryForwardCarryForwardIndex.withTheMonthsThatExisted')
                    : '',
                value4:
                  v.closed.reason !== null && v.closed.reason !== '' ? ` “${v.closed.reason}”` : '',
              })}
            </span>
          </p>
          {viewingOld && (
            <Notice tone="warn" icon={<AlertTriangle size={16} />}>
              <div className="mo-row">
                <span>
                  {t('pnlCarryForwardCarryForwardIndex.youAreLookingAtVersion', {
                    shownVersion: v.shownVersion,
                  })}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setVersion(null)}>
                  {t('pnlCarryForwardCarryForwardIndex.backToTheCurrentVersion')}
                </Button>
              </div>
            </Notice>
          )}
        </MoCard>
      ) : v.status === 'AWAITING_CLOSE' ? (
        <AwaitingClose month={month} name={v.name} canClose={canClose} />
      ) : null}

      <div className="mo-kpis">
        <KpiCard
          label={
            closed
              ? t('pnlCarryForwardCarryForwardIndex.netAsFrozen')
              : t('pnlCarryForwardCarryForwardIndex.thisMonthOnItsOwn')
          }
          tone={Number(v.totals.ownNetInr) >= 0 ? 'credit' : 'debit'}
          figure={<Money amount={v.totals.ownNetInr} currency="INR" convert={false} />}
          hint={
            closed
              ? t('pnlCarryForwardCarryForwardIndex.neverChanges')
              : t('pnlCarryForwardCarryForwardIndex.liveMovesUntilTheMonth')
          }
        />
        <KpiCard
          label={t('pnlCarryForwardCarryForwardIndex.carriedForwardFromEarlierMonths')}
          figure={<Delta amount={v.totals.carriedInNetInr} />}
          hint={t('pnlCarryForwardCarryForwardIndex.changeToClosedMonths', {
            carriedCount,
            value: carriedCount === 1 ? '' : t('common.pluralS'),
          })}
        />
        <KpiCard
          label={t('pnlCarryForwardCarryForwardIndex.netIncludingCarryForwards')}
          tone={Number(v.totals.netInr) >= 0 ? 'credit' : 'debit'}
          figure={<Money amount={v.totals.netInr} currency="INR" convert={false} />}
        />
      </div>

      <PlainSection
        title={
          closed
            ? t('pnlCarryForwardCarryForwardIndex.asFrozen', { name: v.name })
            : t('pnlCarryForwardCarryForwardIndex.onItsOwn', { name: v.name })
        }
      >
        <LinesTable
          report={v.report}
          renderRows={(key) =>
            closed ? (
              <FrozenRows month={month} lineKey={key} version={v.shownVersion} />
            ) : key === 'operating_expenses' ? (
              <p className="pl-state">
                {t('pnlCarryForwardCarryForwardIndex.listedOn')}{' '}
                <Link href="/expenses" className="mo-link">
                  {t('pnlCarryForwardCarryForwardIndex.expenses')}
                </Link>
                .
              </p>
            ) : (
              <LiveRows lineKey={key} from={v.window.from} to={v.window.to} />
            )
          }
        />
      </PlainSection>

      <PlainSection
        title={t('pnlCarryForwardCarryForwardIndex.carriedIntoFromEarlierMonths', { name: v.name })}
      >
        {v.carriedIn.length === 0 ? (
          <EmptyState
            title={t('pnlCarryForwardCarryForwardIndex.nothingCarriedForward')}
            description={
              closed
                ? t('pnlCarryForwardCarryForwardIndex.noChangeToAnEarlier')
                : t('pnlCarryForwardCarryForwardIndex.noChangeToAClosed')
            }
          />
        ) : (
          <CarriedGroups
            groups={v.carriedIn}
            heading={(g) => t('pnlCarryForwardCarryForwardIndex.from', { name: g.name })}
            filterFor={(g, line) => ({ landedIn: month, origin: g.originMonth, line })}
          />
        )}
      </PlainSection>

      {closed && (
        <PlainSection title={t('pnlCarryForwardCarryForwardIndex.changesFoundAfterClosing')}>
          {v.laterChanges.length === 0 ? (
            <EmptyState
              tone="positive"
              title={t('pnlCarryForwardCarryForwardIndex.noneYet')}
              description={t('pnlCarryForwardCarryForwardIndex.nothingHasChangedSinceIt')}
            />
          ) : (
            <div className="mo-stack">
              <p className="mo-p">
                {t('pnlCarryForwardCarryForwardIndex.carriedInto')}{' '}
                {v.laterChanges.map((g, i) => (
                  <Fragment key={g.landedMonth}>
                    {i > 0 && ' · '}
                    <span className="mo-nowrap">
                      {g.name} <Delta amount={g.netInr} />
                    </span>
                  </Fragment>
                ))}
              </p>
              <CarriedGroups
                groups={v.laterChanges}
                heading={(g) =>
                  t('pnlCarryForwardCarryForwardIndex.carriedInto2', { name: g.name })
                }
                filterFor={(g, line) => ({ origin: month, landedIn: g.landedMonth, line })}
              />
            </div>
          )}
        </PlainSection>
      )}

      {closed && !viewingOld && v.lockState === 'PROVISIONAL' && (
        <LockPermanentlyPanel
          month={month}
          name={v.name}
          nightlyJobs={v.shown?.nightlyJobs ?? null}
          canClose={canClose}
        />
      )}

      {closed && v.versions.length > 0 && (
        <MoSection title={t('pnlCarryForwardCarryForwardIndex.lockedVersions')} flush>
          <Table>
            <THead>
              <Tr>
                <Th>{t('pnlCarryForwardCarryForwardIndex.version')}</Th>
                <Th>{t('pnlCarryForwardCarryForwardIndex.how')}</Th>
                <Th>{t('pnlCarryForwardCarryForwardIndex.when')}</Th>
                <Th>{t('pnlCarryForwardCarryForwardIndex.who')}</Th>
                <Th>{t('pnlCarryForwardCarryForwardIndex.reason')}</Th>
                <Th align="right">{t('pnlCarryForwardCarryForwardIndex.netBeforeAfter')}</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {v.versions.map((x) => (
                <Tr key={x.version}>
                  <Td className="sk-figure">
                    v{x.version}
                    {x.current ? ' (current)' : ''}
                  </Td>
                  <Td>
                    {versionKindLabel(t, x.kind)}
                    <div className="mo-faint">
                      {x.lockState === 'PROVISIONAL' ? 'provisional' : 'final'}
                    </div>
                  </Td>
                  <Td className="mo-nowrap">{istDateTime(x.createdAt)}</Td>
                  <Td>{x.by ?? t('pnlCarryForwardCarryForwardIndex.theScheduledClose')}</Td>
                  <Td className="mo-muted">{x.reason ?? '—'}</Td>
                  <Td align="right" className="mo-nowrap">
                    {x.netBeforeInr === null ? (
                      '—'
                    ) : (
                      <Money amount={x.netBeforeInr} currency="INR" convert={false} />
                    )}{' '}
                    → <Money amount={x.netInr} currency="INR" convert={false} />
                  </Td>
                  <Td>
                    {x.version === v.shownVersion ? (
                      <span className="mo-faint">shown</span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setVersion(x.current ? null : x.version)}
                      >
                        {t('pnlCarryForwardCarryForwardIndex.open')}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </MoSection>
      )}

      {closed && !viewingOld && v.lockState === 'FINAL' && canGodMode && (
        <GodModePanel month={month} name={v.name} />
      )}
    </div>
  );
}

function versionKindLabel(t: Translate<MessageKey>, kind: PnlVersionKindView): string {
  switch (kind) {
    case 'AUTO_FINAL':
      return t('pnlCarryForwardCarryForwardIndex.scheduledClose');
    case 'AUTO_PROVISIONAL':
      return t('pnlCarryForwardCarryForwardIndex.scheduledCloseProvisional');
    case 'LOCK_PERMANENTLY':
      return t('pnlCarryForwardCarryForwardIndex.lockedPermanently');
    case 'GOD_MODE':
      return t('pnlCarryForwardCarryForwardIndex.godModeReLockLabel');
    case 'BACKFILL':
      return t('pnlCarryForwardCarryForwardIndex.backfill');
    case 'MANUAL':
      return t('pnlCarryForwardCarryForwardIndex.closedByHand');
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** The nightly jobs a stored gate result says did not succeed. */
function failedJobs(
  t: Translate<MessageKey>,
  raw: unknown,
): Array<{ label: string; detail: string }> {
  const jobs =
    typeof raw === 'object' && raw !== null && Array.isArray((raw as { jobs?: unknown }).jobs)
      ? ((raw as { jobs: unknown[] }).jobs as Array<Record<string, unknown>>)
      : [];
  return jobs
    .filter((j) => j['status'] !== 'OK')
    .map((j) => ({
      label:
        typeof j['label'] === 'string'
          ? j['label']
          : t('pnlCarryForwardCarryForwardIndex.aNightlyJob'),
      detail: typeof j['detail'] === 'string' ? j['detail'] : '',
    }));
}

/** A PROVISIONAL month: which jobs failed, and "Lock permanently". */
function LockPermanentlyPanel({
  month,
  name,
  nightlyJobs,
  canClose,
}: {
  readonly month: string;
  readonly name: string;
  readonly nightlyJobs: unknown;
  readonly canClose: boolean;
}): ReactElement {
  const t = useT();

  const lock = useLockPnlPermanently();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const failed = failedJobs(t, nightlyJobs);
  return (
    <MoSection title={t('pnlCarryForwardCarryForwardIndex.provisionalLock')} tone="warn">
      <Notice tone="warn" icon={<AlertTriangle size={16} />}>
        <p>{t('pnlCarryForwardCarryForwardIndex.wasClosedOnTimeBut', { name })}</p>
      </Notice>
      {failed.length > 0 && (
        <ul className="pl-jobs">
          {failed.map((j) => (
            <li key={j.label}>
              <AlertTriangle size={14} className="pl-warn" aria-hidden />
              <span>
                <strong>{j.label}</strong> — {j.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canClose && (
        <div className="mo-row">
          <Button
            variant="secondary"
            size="sm"
            icon={<Lock size={14} />}
            onClick={() => setOpen(true)}
          >
            {t('pnlCarryForwardCarryForwardIndex.lockPermanently', { name })}
          </Button>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        tone="critical"
        locked={lock.isPending}
        icon={<Lock size={18} />}
        title={t('pnlCarryForwardCarryForwardIndex.lockPermanently', { name })}
        description={t('pnlCarryForwardCarryForwardIndex.itIsReSnapshottedWith')}
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={lock.isPending}>
              {t('pnlCarryForwardCarryForwardIndex.cancel')}
            </Button>
            <AsyncButton
              variant="destructive"
              state={lock.isPending ? 'busy' : error !== null ? 'error' : 'idle'}
              labels={{
                idle: t('pnlCarryForwardCarryForwardIndex.lockPermanently2'),
                busy: t('pnlCarryForwardCarryForwardIndex.locking'),
              }}
              onClick={() =>
                lock.mutate(
                  { month, reason },
                  {
                    onSuccess: () => {
                      setOpen(false);
                      setError(null);
                    },
                    onError: (e) => setError(serverVerdict(e)),
                  },
                )
              }
            />
          </DialogFooter>
        }
      >
        <div className="mo-fields">
          <TextArea
            label={t('pnlCarryForwardCarryForwardIndex.whyItIsBeingLocked')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={t('pnlCarryForwardCarryForwardIndex.eGShiprocketWalletSync')}
          />
          {error !== null && (
            <p className="mo-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </MoSection>
  );
}

/**
 * God mode for a FINAL month — the escalating chrome of the order god mode:
 * a red panel, a reason, a risk acknowledgement and the month typed out.
 * Cosmetic only (FE-2): every guardrail is the server's, and its refusal is
 * shown verbatim.
 */
function GodModePanel({
  month,
  name,
}: {
  readonly month: string;
  readonly name: string;
}): ReactElement {
  const t = useT();
  const relock = useGodModeRelockPnl();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <MoCard tone="critical">
      <Notice
        tone="bad"
        icon={<ShieldAlert size={16} />}
        title={t('pnlCarryForwardCarryForwardIndex.godMode')}
      >
        <p>{t('pnlCarryForwardCarryForwardIndex.reLockAsTheLedgers', { name })}</p>
      </Notice>
      <div className="mo-row">
        <Button
          variant="destructive"
          size="sm"
          icon={<ShieldAlert size={14} />}
          onClick={() => setOpen(true)}
        >
          {t('pnlCarryForwardCarryForwardIndex.reLock', { name })}
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        tone="critical"
        size="lg"
        locked={relock.isPending}
        icon={<ShieldAlert size={18} />}
        title={t('pnlCarryForwardCarryForwardIndex.godModeReLock', { name })}
        description={t('pnlCarryForwardCarryForwardIndex.thisRestatesAMonthThat')}
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={relock.isPending}>
              {t('pnlCarryForwardCarryForwardIndex.cancel')}
            </Button>
            <AsyncButton
              variant="destructive"
              state={relock.isPending ? 'busy' : error !== null ? 'error' : 'idle'}
              labels={{
                idle: t('pnlCarryForwardCarryForwardIndex.reLock', { name }),
                busy: t('pnlCarryForwardCarryForwardIndex.reLocking'),
              }}
              onClick={() =>
                relock.mutate(
                  { month, reason, confirmMonth: typed, acknowledgeRisk: ack },
                  {
                    onSuccess: () => {
                      setOpen(false);
                      setError(null);
                    },
                    onError: (e) => setError(serverVerdict(e)),
                  },
                )
              }
            />
          </DialogFooter>
        }
      >
        <div className="mo-fields">
          <TextArea
            label={t('pnlCarryForwardCarryForwardIndex.justificationAtLeast30Characters')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder={t('pnlCarryForwardCarryForwardIndex.whatWasWrongWithThe')}
          />
          <Checkbox
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            label={<>{t('pnlCarryForwardCarryForwardIndex.iUnderstandThisReplacesS', { name })}</>}
          />
          <TextField
            label={t('pnlCarryForwardCarryForwardIndex.typeToConfirm', { month })}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="pl-god-typed"
            autoComplete="off"
            spellCheck={false}
          />
          {error !== null && (
            <p className="mo-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </MoCard>
  );
}

/** A month that has ended and is not closed: what it is waiting for, and the hand close. */
function AwaitingClose({
  month,
  name,
  canClose,
}: {
  readonly month: string;
  readonly name: string;
  readonly canClose: boolean;
}): ReactElement {
  const t = useT();
  const jobs = usePnlNightlyJobs(month);
  const close = useClosePnlMonth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <MoCard tone="warn">
      <Notice tone="warn" icon={<AlertTriangle size={16} />}>
        <p>{t('pnlCarryForwardCarryForwardIndex.hasEndedAndIsNot', { name })}</p>
      </Notice>
      {jobs.isLoading ? (
        <SkeletonRows
          rows={3}
          cols={2}
          label={t('pnlCarryForwardCarryForwardIndex.checkingTheNightlyJobs')}
        />
      ) : jobs.isError || jobs.data === undefined ? (
        <p className="pl-state" data-tone="bad" role="alert">
          {jobs.error?.message ?? t('pnlCarryForwardCarryForwardIndex.couldNotReadTheNightly')}
        </p>
      ) : (
        <ul className="pl-jobs">
          {jobs.data.jobs.map((j) => (
            <li key={j.key}>
              {j.status === 'OK' ? (
                <CheckCircle2 size={14} className="pl-ok" aria-hidden />
              ) : (
                <AlertTriangle size={14} className="pl-warn" aria-hidden />
              )}
              <span>
                <strong>{j.label}</strong> — {j.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canClose && (
        <div className="mo-row">
          <Button
            variant="secondary"
            size="sm"
            icon={<Lock size={14} />}
            onClick={() => setOpen(true)}
          >
            {t('pnlCarryForwardCarryForwardIndex.close', { name })}
          </Button>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        tone="critical"
        locked={close.isPending}
        icon={<Lock size={18} />}
        title={t('pnlCarryForwardCarryForwardIndex.close', { name })}
        description={t('pnlCarryForwardCarryForwardIndex.itsFiguresAreFrozenFor')}
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={close.isPending}>
              {t('pnlCarryForwardCarryForwardIndex.cancel')}
            </Button>
            <AsyncButton
              variant="destructive"
              state={close.isPending ? 'busy' : error !== null ? 'error' : 'idle'}
              labels={{
                idle: t('pnlCarryForwardCarryForwardIndex.close', { name }),
                busy: t('pnlCarryForwardCarryForwardIndex.closing'),
              }}
              onClick={() =>
                close.mutate(
                  { month, reason },
                  {
                    onSuccess: () => {
                      setOpen(false);
                      setError(null);
                    },
                    onError: (e) => setError(serverVerdict(e)),
                  },
                )
              }
            />
          </DialogFooter>
        }
      >
        <div className="mo-fields">
          <TextArea
            label={t('pnlCarryForwardCarryForwardIndex.whyItIsBeingClosed')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={t('pnlCarryForwardCarryForwardIndex.eGShiprocketWalletSync2')}
          />
          {error !== null && (
            <p className="mo-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </MoCard>
  );
}

interface LineRow {
  readonly key: string;
  readonly label: string;
  readonly revenueInr: string;
  readonly costInr: string;
  readonly marginInr: string;
  readonly note: string | null;
}

/** A month's lines, operating expenses and net, each opening to the records behind it. */
function LinesTable({
  report,
  renderRows,
}: {
  readonly report: PnlReportView;
  readonly renderRows: (lineKey: string) => ReactElement;
}): ReactElement {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const rows: LineRow[] = [
    ...report.lines.map((l) => ({
      key: l.key,
      label: l.label,
      revenueInr: l.revenueInr,
      costInr: l.costInr,
      marginInr: l.marginInr,
      note: l.coverage.note,
    })),
    {
      key: 'operating_expenses',
      label: t('pnlCarryForwardCarryForwardIndex.operatingExpenses'),
      revenueInr: '0.00',
      costInr: report.operatingExpensesInr,
      marginInr: negate(report.operatingExpensesInr),
      note: null,
    },
  ];
  const warnings = report.warnings ?? [];
  return (
    <div className="mo-stack">
      {(warnings.length > 0 || !report.complete) && (
        <Notice tone="warn" icon={<AlertTriangle size={16} />}>
          <ul className="mo-list">
            {!report.complete && (
              <li>{t('pnlCarryForwardCarryForwardIndex.someCostWasNotRecorded')}</li>
            )}
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}
      <Accordion value={open} onValueChange={setOpen}>
        {rows.map((l) => {
          const isOpen = open === l.key;
          return (
            <AccordionItem
              key={l.key}
              value={l.key}
              icon={<Layers size={16} />}
              title={
                <span className="pl-line">
                  <span>
                    <span className="pl-line__label">{l.label}</span>
                    {l.note !== null && <span className="pl-line__note">{l.note}</span>}
                  </span>
                  <span className="pl-figs" data-cols="3">
                    <Fig label={t('pnlCarryForwardCarryForwardIndex.revenue')}>
                      <Money amount={l.revenueInr} currency="INR" convert={false} />
                    </Fig>
                    <Fig label={t('pnlCarryForwardCarryForwardIndex.cost')}>
                      <Money amount={l.costInr} currency="INR" convert={false} />
                    </Fig>
                    <Fig label={t('pnlCarryForwardCarryForwardIndex.margin')}>
                      <Money amount={l.marginInr} currency="INR" convert={false} />
                    </Fig>
                  </span>
                </span>
              }
            >
              {/* Mounted only while open, so the records behind a line are
                  fetched when it is opened, as before. */}
              {isOpen && renderRows(l.key)}
            </AccordionItem>
          );
        })}
      </Accordion>
      <div className="pl-net">
        <span>{t('pnlCarryForwardCarryForwardIndex.net')}</span>
        <Money amount={report.netInr} currency="INR" convert={false} />
      </div>
    </div>
  );
}

/** One labelled figure in a line's header. The value is the caller's own node. */
function Fig({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactElement;
}): ReactElement {
  return (
    <span className="pl-fig">
      <span className="pl-fig__label">{label}</span>
      <span className="pl-fig__value">{children}</span>
    </span>
  );
}

/** A drill-down that could not load, with its own Retry. */
function RowsError({
  message,
  retry,
}: {
  readonly message: string;
  readonly retry: () => void;
}): ReactElement {
  const t = useT();
  return (
    <p className="pl-state" data-tone="bad" role="alert">
      {message}{' '}
      <Button variant="ghost" size="sm" onClick={retry}>
        {t('pnlCarryForwardCarryForwardIndex.retry')}
      </Button>
    </p>
  );
}

function RowsTable({
  rows,
  truncated,
}: {
  readonly rows: ReadonlyArray<{
    readonly key: string;
    readonly ref: string;
    readonly subRef: string | null;
    readonly at: string;
    readonly revenueInr: string | null;
    readonly costInr: string | null;
  }>;
  readonly truncated: boolean;
}): ReactElement {
  const t = useT();
  if (rows.length === 0) {
    return (
      <p className="pl-state">{t('pnlCarryForwardCarryForwardIndex.nothingBehindThisLine')}</p>
    );
  }
  return (
    <div className="pl-drill">
      <Table maxHeight="20rem">
        <THead>
          <Tr>
            <Th>{t('pnlCarryForwardCarryForwardIndex.reference')}</Th>
            <Th>{t('pnlCarryForwardCarryForwardIndex.date')}</Th>
            <Th align="right">{t('pnlCarryForwardCarryForwardIndex.revenue')}</Th>
            <Th align="right">{t('pnlCarryForwardCarryForwardIndex.cost')}</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Tr key={r.key}>
              <Td>
                <span className="sk-ident">{r.ref}</span>
                {r.subRef !== null && <div className="mo-faint">{r.subRef}</div>}
              </Td>
              <Td className="mo-nowrap">{r.at === '' ? '—' : istDateLabel(r.at)}</Td>
              <Td align="right">
                {r.revenueInr === null ? (
                  <span className="mo-faint">—</span>
                ) : (
                  <Money amount={r.revenueInr} currency="INR" convert={false} />
                )}
              </Td>
              <Td align="right">
                {r.costInr === null ? (
                  <span className="mo-warn">
                    {t('pnlCarryForwardCarryForwardIndex.notRecorded')}
                  </span>
                ) : (
                  <Money amount={r.costInr} currency="INR" convert={false} />
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      {truncated && (
        <p className="pl-state" data-tone="warn">
          {t('pnlCarryForwardCarryForwardIndex.onlyTheFirstRowsAre', { length: rows.length })}
        </p>
      )}
    </div>
  );
}

function FrozenRows({
  month,
  lineKey,
  version,
}: {
  readonly month: string;
  readonly lineKey: string;
  readonly version: number | null;
}): ReactElement {
  const t = useT();
  const q = usePnlFrozenRows(month, lineKey, version);
  if (q.isLoading)
    return (
      <SkeletonRows rows={3} cols={4} label={t('pnlCarryForwardCarryForwardIndex.loadingRows')} />
    );
  if (q.isError || q.data === undefined) {
    return (
      <RowsError
        message={q.error?.message ?? t('pnlCarryForwardCarryForwardIndex.couldNotLoadTheRows')}
        retry={() => void q.refetch()}
      />
    );
  }
  return (
    <RowsTable
      rows={q.data.rows.map((r) => ({ ...r, key: r.refKey }))}
      truncated={q.data.truncated}
    />
  );
}

function LiveRows({
  lineKey,
  from,
  to,
}: {
  readonly lineKey: string;
  readonly from: string;
  readonly to: string;
}): ReactElement {
  const t = useT();
  const q = usePnlLineItems(lineKey, from, to);
  if (q.isLoading)
    return (
      <SkeletonRows rows={3} cols={4} label={t('pnlCarryForwardCarryForwardIndex.loadingRows')} />
    );
  if (q.isError || q.data === undefined) {
    return (
      <RowsError
        message={q.error?.message ?? t('pnlCarryForwardCarryForwardIndex.couldNotLoadTheRows')}
        retry={() => void q.refetch()}
      />
    );
  }
  return (
    <RowsTable
      rows={q.data.items.map((r, i) => ({ ...r, key: `${r.ref}-${i}` }))}
      truncated={q.data.truncated}
    />
  );
}

/** Carry-forwards grouped by month, then line; each line opens to its records and reasons. */
function CarriedGroups({
  groups,
  heading,
  filterFor,
}: {
  readonly groups: readonly CarriedGroupView[];
  readonly heading: (g: CarriedGroupView) => string;
  readonly filterFor: (g: CarriedGroupView, line: string) => CarryForwardFilter;
}): ReactElement {
  const t = useT();

  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="mo-stack">
      {groups.map((g) => (
        <div key={`${g.originMonth}-${g.landedMonth}`} className="pl-group">
          <div className="pl-group__head">
            <h3 className="pl-group__title">{heading(g)}</h3>
            <span className="mo-muted">
              {richMessage(t('pnlCarryForwardCarryForwardIndex.netChange'), {
                delta: <Delta amount={g.netInr} />,
                count: g.count,
                value: g.count === 1 ? '' : t('common.pluralS'),
              })}
            </span>
          </div>
          <Accordion value={open} onValueChange={setOpen}>
            {g.lines.map((l) => {
              const id = `${g.originMonth}-${g.landedMonth}-${l.lineKey}`;
              const isOpen = open === id;
              return (
                <AccordionItem
                  key={id}
                  value={id}
                  icon={<Layers size={16} />}
                  title={
                    <span className="pl-line">
                      <span className="pl-line__label">
                        {l.name} <span className="pl-count">({l.count})</span>
                      </span>
                      <span className="pl-figs" data-cols="3">
                        <Fig label={t('pnlCarryForwardCarryForwardIndex.revenue')}>
                          <Money amount={l.revenueInr} currency="INR" convert={false} />
                        </Fig>
                        <Fig label={t('pnlCarryForwardCarryForwardIndex.cost')}>
                          <Money amount={l.costInr} currency="INR" convert={false} />
                        </Fig>
                        <Fig label={t('pnlCarryForwardCarryForwardIndex.net')}>
                          <Delta amount={l.netInr} />
                        </Fig>
                      </span>
                    </span>
                  }
                >
                  {isOpen && <CarriedRows filter={filterFor(g, l.lineKey)} />}
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      ))}
    </div>
  );
}

function CarriedRows({ filter }: { readonly filter: CarryForwardFilter }): ReactElement {
  const t = useT();
  const q = usePnlCarryForwardRows(filter);
  if (q.isLoading)
    return (
      <SkeletonRows
        rows={3}
        cols={6}
        label={t('pnlCarryForwardCarryForwardIndex.loadingChanges')}
      />
    );
  if (q.isError || q.data === undefined) {
    return (
      <RowsError
        message={q.error?.message ?? t('pnlCarryForwardCarryForwardIndex.couldNotLoadTheChanges')}
        retry={() => void q.refetch()}
      />
    );
  }
  if (q.data.rows.length === 0) {
    return <p className="pl-state">{t('pnlCarryForwardCarryForwardIndex.noChanges')}</p>;
  }
  return (
    <div className="pl-drill">
      <Table maxHeight="24rem">
        <THead>
          <Tr>
            <Th>{t('pnlCarryForwardCarryForwardIndex.record')}</Th>
            <Th>{t('pnlCarryForwardCarryForwardIndex.whatChanged')}</Th>
            <Th>{t('pnlCarryForwardCarryForwardIndex.found')}</Th>
            <Th align="right">{t('pnlCarryForwardCarryForwardIndex.revenue')}</Th>
            <Th align="right">{t('pnlCarryForwardCarryForwardIndex.cost')}</Th>
            <Th align="right">{t('pnlCarryForwardCarryForwardIndex.net')}</Th>
          </Tr>
        </THead>
        <TBody>
          {q.data.rows.map((r) => (
            <Tr key={r.id}>
              <Td>
                <span className="sk-ident">{r.ref}</span>
                {r.subRef !== null && <div className="mo-faint">{r.subRef}</div>}
              </Td>
              <Td>{r.reason}</Td>
              <Td className="mo-nowrap">{istDateLabel(r.detectedAt)}</Td>
              <Td align="right">
                <Money amount={r.revenueDeltaInr} currency="INR" convert={false} />
              </Td>
              <Td align="right">
                <Money amount={r.costDeltaInr} currency="INR" convert={false} />
              </Td>
              <Td align="right">
                <Delta amount={r.netInr} />
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      {q.data.truncated && (
        <p className="pl-state" data-tone="warn">
          {t('pnlCarryForwardCarryForwardIndex.onlyTheFirstChangesAre', {
            rowsLength: q.data.rows.length,
          })}
        </p>
      )}
    </div>
  );
}

/**
 * Closing the months that existed before carry-forward did — once, after
 * deploy. Preview first (a dry run writes nothing); closing is final.
 */
function BackfillPanel(): ReactElement {
  const t = useT();
  const backfill = useBackfillPnlClose();
  const [through, setThrough] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<BackfillResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // The REAL close's progress, from the request itself (a dry run shows none).
  const [closing, setClosing] = useState<'running' | 'done' | 'failed' | null>(null);

  const run = (dryRun: boolean): void => {
    if (!dryRun) setClosing('running');
    backfill.mutate(
      {
        dryRun,
        ...(through === '' ? {} : { throughMonth: through }),
        ...(dryRun ? {} : { reason }),
      },
      {
        onSuccess: (r) => {
          setResult(r);
          setError(null);
          if (!dryRun) setClosing('done');
        },
        onError: (e) => {
          setError(serverVerdict(e));
          if (!dryRun) setClosing('failed');
        },
      },
    );
  };

  const wouldClose =
    result === null ? 0 : result.months.filter((m) => m.action === 'WOULD_CLOSE').length;

  return (
    <MoSection title={t('pnlCarryForwardCarryForwardIndex.closeEarlierMonths')}>
      <p className="mo-p">{t('pnlCarryForwardCarryForwardIndex.closesEveryMonthWithAnything')}</p>
      <div className="pl-through">
        <DateField
          type="month"
          label={t('pnlCarryForwardCarryForwardIndex.throughMonth')}
          value={through}
          onChange={(e) => setThrough(e.target.value)}
        />
        <Button
          variant="secondary"
          disabled={backfill.isPending}
          loading={backfill.isPending && closing !== 'running'}
          onClick={() => run(true)}
        >
          {t('pnlCarryForwardCarryForwardIndex.preview')}
        </Button>
      </div>
      {closing !== null && (
        <ParachuteProgress
          label={t('pnlCarryForwardCarryForwardIndex.closingTheMonths')}
          value={null}
          state={closing}
          doneLabel={t('pnlCarryForwardCarryForwardIndex.monthsClosed')}
          failedLabel={t('pnlCarryForwardCarryForwardIndex.closingFailed')}
          detail={closing === 'failed' ? (error ?? undefined) : undefined}
        />
      )}
      {error !== null && closing !== 'failed' && (
        <p className="mo-error" role="alert">
          {error}
        </p>
      )}
      {result !== null && (
        <>
          <Table>
            <THead>
              <Tr>
                <Th>{t('pnlCarryForwardCarryForwardIndex.month')}</Th>
                <Th>
                  {result.dryRun
                    ? t('pnlCarryForwardCarryForwardIndex.would')
                    : t('pnlCarryForwardCarryForwardIndex.result')}
                </Th>
                <Th align="right">{t('pnlCarryForwardCarryForwardIndex.net')}</Th>
                <Th>{t('pnlCarryForwardCarryForwardIndex.note')}</Th>
              </Tr>
            </THead>
            <TBody>
              {result.months.length === 0 ? (
                <TableEmpty colSpan={4}>
                  {t('pnlCarryForwardCarryForwardIndex.noMonthHasAnythingOn')}
                </TableEmpty>
              ) : (
                result.months.map((m) => (
                  <Tr key={m.month}>
                    <Td className="sk-ident">{m.month}</Td>
                    <Td>{m.action.replaceAll('_', ' ').toLowerCase()}</Td>
                    <Td align="right">
                      {m.netInr === null ? (
                        '—'
                      ) : (
                        <Money amount={m.netInr} currency="INR" convert={false} />
                      )}
                    </Td>
                    <Td className="mo-muted">{m.note ?? ''}</Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
          {result.dryRun && result.months.some((m) => m.action === 'WOULD_CLOSE') && (
            <div className="mo-fields">
              <TextArea
                label={t('pnlCarryForwardCarryForwardIndex.whyTheseMonthsAreBeing')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder={t('pnlCarryForwardCarryForwardIndex.eGStartingTheCarry')}
              />
              <div className="mo-row">
                <Button
                  variant="destructive"
                  disabled={backfill.isPending}
                  icon={<Lock size={14} />}
                  onClick={() => setConfirming(true)}
                >
                  {t('pnlCarryForwardCarryForwardIndex.closeTheseMonths')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('pnlCarryForwardCarryForwardIndex.closeTheseMonthsForGood')}
        entity={
          through === ''
            ? t('pnlCarryForwardCarryForwardIndex.everyMonthThroughLastMonth')
            : t('pnlCarryForwardCarryForwardIndex.everyMonthThrough', { through })
        }
        amount={`${wouldClose} month${wouldClose === 1 ? '' : 's'}`}
        consequence={t('pnlCarryForwardCarryForwardIndex.theirFiguresAreFrozenAs')}
        confirmLabel={t('pnlCarryForwardCarryForwardIndex.closeThem')}
        destructive
        onConfirm={() => {
          setConfirming(false);
          run(false);
        }}
      />
    </MoSection>
  );
}
