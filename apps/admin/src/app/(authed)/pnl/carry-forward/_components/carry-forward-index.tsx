'use client';

import Link from 'next/link';
import { Fragment, useState, type ReactElement } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Lock } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  Money,
  PageHeader,
  Section,
  Select,
  Stat,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
} from '@skydrop/ui/components';
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
  const periods = usePnlPeriods();
  const [picked, setPicked] = useState<string | null>(null);
  // Closing is irreversible and has its own permission; the page is
  // readable by anyone who can read /pnl. Cosmetic only — the API decides.
  const canClose = usePermission('money.pnl.close');
  // Restating a permanently locked month is its own, stronger permission.
  const canGodMode = usePermission('money.pnl.god_mode');
  const month = picked ?? periods.data?.currentMonth ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Carry-forward P&L"
        subtitle="Each month frozen once it closes. A change to a closed month is carried into the month open when it was found, so a reported month never moves."
        action={
          <Link href="/pnl" className="text-accent text-sm hover:underline">
            Live P&amp;L
          </Link>
        }
      />

      {periods.isLoading ? (
        <LoadingState />
      ) : periods.isError || periods.data === undefined ? (
        <ErrorState
          message={periods.error?.message ?? 'Could not load the months.'}
          retry={() => void periods.refetch()}
        />
      ) : (
        <>
          <Card>
            <CardBody>
              <div className="max-w-sm">
                <FormField label="Month">
                  <Select value={month ?? ''} onChange={(e) => setPicked(e.target.value)}>
                    {periods.data.months.map((m) => (
                      <option key={m.month} value={m.month}>
                        {m.name} — {statusWord(m.status)}
                        {m.lockState === 'PROVISIONAL' ? ' (provisional)' : ''}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
            </CardBody>
          </Card>
          {month !== null && (
            <MonthView key={month} month={month} canClose={canClose} canGodMode={canGodMode} />
          )}
          {canClose && <BackfillPanel />}
        </>
      )}
    </div>
  );
}

function statusWord(s: PnlMonthStatus): string {
  switch (s) {
    case 'CLOSED':
      return 'closed';
    case 'OPEN':
      return 'open';
    case 'AWAITING_CLOSE':
      return 'not closed yet';
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
  // A locked version other than the current one, opened read-only.
  const [version, setVersion] = useState<number | null>(null);
  const q = usePnlMonth(month, version);
  if (q.isLoading) return <LoadingState />;
  if (q.isError || q.data === undefined) {
    return (
      <ErrorState
        message={q.error?.message ?? 'Could not load this month.'}
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
    <div className="space-y-4">
      {v.closed !== null ? (
        <Card>
          <CardBody>
            <div className="space-y-2 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <Lock className="h-4 w-4 shrink-0" aria-hidden />
                <span className="rounded-[4px] border border-border px-1.5 py-0.5 text-xs font-semibold tracking-wide">
                  {v.lockState === 'PROVISIONAL' ? 'PROVISIONAL' : 'LOCKED PERMANENTLY'}
                </span>
                <span>
                  Closed on {istDateTime(v.closed.at)}{' '}
                  {v.closed.by === null ? 'by the scheduled close' : `by ${v.closed.by}`}
                  {v.closed.kind === 'BACKFILL'
                    ? ', with the months that existed before carry-forward'
                    : ''}
                  .
                  {v.closed.reason !== null && v.closed.reason !== ''
                    ? ` “${v.closed.reason}”`
                    : ''}
                </span>
              </p>
              {viewingOld && (
                <p className="text-warning flex flex-wrap items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  You are looking at version {v.shownVersion}, which has been replaced — read only.
                  <Button variant="ghost" size="sm" onClick={() => setVersion(null)}>
                    Back to the current version
                  </Button>
                </p>
              )}
            </div>
          </CardBody>
        </Card>
      ) : v.status === 'AWAITING_CLOSE' ? (
        <AwaitingClose month={month} name={v.name} canClose={canClose} />
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label={closed ? 'Net, as frozen' : 'This month on its own'}
          tone={Number(v.totals.ownNetInr) >= 0 ? 'good' : 'bad'}
          value={<Money amount={v.totals.ownNetInr} currency="INR" convert={false} />}
          hint={closed ? 'Never changes' : 'Live — moves until the month closes'}
        />
        <Stat
          label="Carried forward from earlier months"
          value={<Delta amount={v.totals.carriedInNetInr} />}
          hint={`${carriedCount} change${carriedCount === 1 ? '' : 's'} to closed months`}
        />
        <Stat
          label="Net including carry-forwards"
          tone={Number(v.totals.netInr) >= 0 ? 'good' : 'bad'}
          value={<Money amount={v.totals.netInr} currency="INR" convert={false} />}
        />
      </div>

      <Section title={closed ? `${v.name}, as frozen` : `${v.name} on its own`}>
        <LinesTable
          report={v.report}
          renderRows={(key) =>
            closed ? (
              <FrozenRows month={month} lineKey={key} version={v.shownVersion} />
            ) : key === 'operating_expenses' ? (
              <p className="text-text-faint py-2 text-xs">
                Listed on <Link href="/expenses">Expenses</Link>.
              </p>
            ) : (
              <LiveRows lineKey={key} from={v.window.from} to={v.window.to} />
            )
          }
        />
      </Section>

      <Section title={`Carried into ${v.name} from earlier months`}>
        {v.carriedIn.length === 0 ? (
          <EmptyState
            bare
            title="Nothing carried forward"
            description={
              closed
                ? 'No change to an earlier month was found while this one was open.'
                : 'No change to a closed month has been found this month yet. Closed months are re-checked every morning at 06:15 IST.'
            }
          />
        ) : (
          <CarriedGroups
            groups={v.carriedIn}
            heading={(g) => `From ${g.name}`}
            filterFor={(g, line) => ({ landedIn: month, origin: g.originMonth, line })}
          />
        )}
      </Section>

      {closed && (
        <Section title="Changes found after closing">
          {v.laterChanges.length === 0 ? (
            <EmptyState bare title="None yet" description="Nothing has changed since it closed." />
          ) : (
            <div className="space-y-3">
              <p className="text-sm">
                Carried into:{' '}
                {v.laterChanges.map((g, i) => (
                  <Fragment key={g.landedMonth}>
                    {i > 0 && ' · '}
                    <span className="whitespace-nowrap">
                      {g.name} <Delta amount={g.netInr} />
                    </span>
                  </Fragment>
                ))}
              </p>
              <CarriedGroups
                groups={v.laterChanges}
                heading={(g) => `Carried into ${g.name}`}
                filterFor={(g, line) => ({ origin: month, landedIn: g.landedMonth, line })}
              />
            </div>
          )}
        </Section>
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
        <Section title="Locked versions">
          <Table>
            <THead>
              <Tr>
                <Th>Version</Th>
                <Th>How</Th>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Reason</Th>
                <Th align="right">Net before → after</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {v.versions.map((x) => (
                <Tr key={x.version}>
                  <Td className="tabular-nums">
                    v{x.version}
                    {x.current ? ' (current)' : ''}
                  </Td>
                  <Td>
                    {versionKindLabel(x.kind)}
                    <div className="text-text-faint text-xs">
                      {x.lockState === 'PROVISIONAL' ? 'provisional' : 'final'}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">{istDateTime(x.createdAt)}</Td>
                  <Td>{x.by ?? 'the scheduled close'}</Td>
                  <Td className="text-xs">{x.reason ?? '—'}</Td>
                  <Td align="right" className="whitespace-nowrap">
                    {x.netBeforeInr === null ? (
                      '—'
                    ) : (
                      <Money amount={x.netBeforeInr} currency="INR" convert={false} />
                    )}{' '}
                    → <Money amount={x.netInr} currency="INR" convert={false} />
                  </Td>
                  <Td>
                    {x.version === v.shownVersion ? (
                      <span className="text-text-faint text-xs">shown</span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setVersion(x.current ? null : x.version)}
                      >
                        Open
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Section>
      )}

      {closed && !viewingOld && v.lockState === 'FINAL' && canGodMode && (
        <GodModePanel month={month} name={v.name} />
      )}
    </div>
  );
}

function versionKindLabel(kind: PnlVersionKindView): string {
  switch (kind) {
    case 'AUTO_FINAL':
      return 'Scheduled close';
    case 'AUTO_PROVISIONAL':
      return 'Scheduled close (provisional)';
    case 'LOCK_PERMANENTLY':
      return 'Locked permanently';
    case 'GOD_MODE':
      return 'God mode re-lock';
    case 'BACKFILL':
      return 'Backfill';
    case 'MANUAL':
      return 'Closed by hand';
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** The nightly jobs a stored gate result says did not succeed. */
function failedJobs(raw: unknown): Array<{ label: string; detail: string }> {
  const jobs =
    typeof raw === 'object' && raw !== null && Array.isArray((raw as { jobs?: unknown }).jobs)
      ? ((raw as { jobs: unknown[] }).jobs as Array<Record<string, unknown>>)
      : [];
  return jobs
    .filter((j) => j['status'] !== 'OK')
    .map((j) => ({
      label: typeof j['label'] === 'string' ? j['label'] : 'A nightly job',
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
  const lock = useLockPnlPermanently();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const failed = failedJobs(nightlyJobs);
  return (
    <Section title="Provisional lock">
      <Card>
        <CardBody>
          <div className="space-y-3 text-sm">
            <p className="text-warning flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {name} was closed on time, but not every nightly job had succeeded, so some of its
              costs may be missing. Nothing is carried out of it while it is provisional — late data
              stays in the month. Fix and re-run the job, then lock it permanently.
            </p>
            {failed.length > 0 && (
              <ul className="space-y-1">
                {failed.map((j) => (
                  <li key={j.label} className="flex items-start gap-2 text-xs">
                    <AlertTriangle
                      className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0"
                      aria-hidden
                    />
                    <span>
                      <strong>{j.label}</strong> — {j.detail}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canClose && (
              <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
                Lock {name} permanently
              </Button>
            )}
          </div>
          <Modal
            open={open}
            onOpenChange={setOpen}
            tone="critical"
            title={`Lock ${name} permanently`}
            description="It is re-snapshotted with everything that has arrived and becomes final. The provisional version is kept. Changes after this are carried into the open month."
          >
            <FormField label="Why it is being locked now">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Shiprocket wallet sync fixed and re-run on 3 Oct"
              />
            </FormField>
            {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
            <ModalFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={lock.isPending}
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
              >
                {lock.isPending ? 'Locking…' : 'Lock permanently'}
              </Button>
            </ModalFooter>
          </Modal>
        </CardBody>
      </Card>
    </Section>
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
  const relock = useGodModeRelockPnl();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="rounded-[5px] border border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] px-4 py-3">
      <div className="text-critical flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="space-y-2">
          <p>
            <strong>God mode.</strong> Re-lock {name} as the ledgers say today. Everything already
            carried into later months stays there and is left out of the new version, so nothing is
            counted twice. Every earlier version is kept.
          </p>
          <Button variant="override" size="sm" onClick={() => setOpen(true)}>
            Re-lock {name}
          </Button>
        </div>
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        tone="critical"
        size="lg"
        title={`God mode: re-lock ${name}`}
        description="This restates a month that was locked permanently. It is audited as CRITICAL."
      >
        <div className="space-y-4">
          <FormField label="Justification (at least 30 characters)">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="What was wrong with the locked figures, and where the corrected data came from"
            />
          </FormField>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="mt-0.5 accent-[var(--color-critical)]"
            />
            <span className="text-text-body text-sm">
              I understand this replaces {name}&apos;s locked figures. A report already sent for
              that month will no longer match the page.
            </span>
          </label>
          <FormField label={`Type ${month} to confirm`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} className="font-mono" />
          </FormField>
          {error !== null && <p className="text-danger text-sm">{error}</p>}
        </div>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="override"
            disabled={relock.isPending}
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
          >
            {relock.isPending ? 'Re-locking…' : `Re-lock ${name}`}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
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
  const jobs = usePnlNightlyJobs(month);
  const close = useClosePnlMonth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardBody>
        <div className="space-y-3 text-sm">
          <p className="text-warning flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {name} has ended and is not closed yet. It closes by itself at 06:00 IST on the 1st —
            permanently when every nightly job has succeeded, provisionally when one has not. Until
            then its figures below are live.
          </p>
          {jobs.isLoading ? (
            <p className="text-text-muted text-xs">Checking the nightly jobs…</p>
          ) : jobs.isError || jobs.data === undefined ? (
            <p className="text-danger text-xs">
              {jobs.error?.message ?? 'Could not read the nightly jobs.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {jobs.data.jobs.map((j) => (
                <li key={j.key} className="flex items-start gap-2 text-xs">
                  {j.status === 'OK' ? (
                    <CheckCircle2
                      className="text-success mt-0.5 h-3.5 w-3.5 shrink-0"
                      aria-hidden
                    />
                  ) : (
                    <AlertTriangle
                      className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0"
                      aria-hidden
                    />
                  )}
                  <span>
                    <strong>{j.label}</strong> — {j.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canClose && (
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              Close {name}
            </Button>
          )}
        </div>
        <Modal
          open={open}
          onOpenChange={setOpen}
          tone="critical"
          title={`Close ${name}`}
          description="Its figures are frozen for good — a closed month is never reopened. Anything that changes it later is carried into the open month."
        >
          <FormField label="Why it is being closed by hand">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Shiprocket wallet sync is switched off; its ledger was imported by hand"
            />
          </FormField>
          {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
          <ModalFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={close.isPending}
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
            >
              {close.isPending ? 'Closing…' : `Close ${name}`}
            </Button>
          </ModalFooter>
        </Modal>
      </CardBody>
    </Card>
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
      label: 'Operating expenses',
      revenueInr: '0.00',
      costInr: report.operatingExpensesInr,
      marginInr: negate(report.operatingExpensesInr),
      note: null,
    },
  ];
  const warnings = report.warnings ?? [];
  return (
    <div className="space-y-3">
      {(warnings.length > 0 || !report.complete) && (
        <div className="text-warning flex gap-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <ul className="space-y-1">
            {!report.complete && (
              <li>Some cost was not recorded, so the margins read higher than they are.</li>
            )}
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <Table>
        <THead>
          <Tr>
            <Th>Line</Th>
            <Th align="right">Revenue</Th>
            <Th align="right">Cost</Th>
            <Th align="right">Margin</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((l) => {
            const isOpen = open === l.key;
            return (
              <Fragment key={l.key}>
                <Tr>
                  <Td>
                    <button
                      type="button"
                      className="hover:text-text-bright flex items-center gap-1.5 text-left font-medium"
                      onClick={() => setOpen(isOpen ? null : l.key)}
                      aria-expanded={isOpen}
                    >
                      <ChevronRight
                        className={`size-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                        aria-hidden
                      />
                      {l.label}
                    </button>
                    {l.note !== null && <div className="text-muted mt-0.5 text-xs">{l.note}</div>}
                  </Td>
                  <Td align="right">
                    <Money amount={l.revenueInr} currency="INR" convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={l.costInr} currency="INR" convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={l.marginInr} currency="INR" convert={false} />
                  </Td>
                </Tr>
                {isOpen && (
                  <Tr>
                    <Td colSpan={4} className="bg-surface-raised">
                      {renderRows(l.key)}
                    </Td>
                  </Tr>
                )}
              </Fragment>
            );
          })}
          <Tr>
            <Td className="font-semibold">Net</Td>
            <Td />
            <Td />
            <Td align="right" className="font-semibold">
              <Money amount={report.netInr} currency="INR" convert={false} />
            </Td>
          </Tr>
        </TBody>
      </Table>
    </div>
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
  if (rows.length === 0) {
    return <p className="text-text-faint py-2 text-xs">Nothing behind this line.</p>;
  }
  return (
    <div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs">
          <thead className="text-text-faint sticky top-0 bg-[var(--color-surface-raised)] text-left">
            <tr>
              <th className="py-1 pr-2 font-medium">Reference</th>
              <th className="py-1 pr-2 font-medium">Date</th>
              <th className="py-1 pr-2 text-right font-medium">Revenue</th>
              <th className="py-1 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-border/60 border-t">
                <td className="py-1 pr-2">
                  <span className="font-mono">{r.ref}</span>
                  {r.subRef !== null && <div className="text-text-faint">{r.subRef}</div>}
                </td>
                <td className="text-text-muted py-1 pr-2 whitespace-nowrap">
                  {r.at === '' ? '—' : istDateLabel(r.at)}
                </td>
                <td className="py-1 pr-2 text-right">
                  {r.revenueInr === null ? (
                    <span className="text-text-faint">—</span>
                  ) : (
                    <Money amount={r.revenueInr} currency="INR" convert={false} />
                  )}
                </td>
                <td className="py-1 text-right">
                  {r.costInr === null ? (
                    <span className="text-warning">not recorded</span>
                  ) : (
                    <Money amount={r.costInr} currency="INR" convert={false} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <p className="text-warning mt-2 text-xs">
          Only the first {rows.length} rows are shown, so they will not add up to the line.
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
  const q = usePnlFrozenRows(month, lineKey, version);
  if (q.isLoading) return <p className="text-text-muted py-2 text-xs">Loading rows…</p>;
  if (q.isError || q.data === undefined) {
    return (
      <p className="text-danger py-2 text-xs">
        {q.error?.message ?? 'Could not load the rows.'}{' '}
        <button type="button" className="underline" onClick={() => void q.refetch()}>
          Retry
        </button>
      </p>
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
  const q = usePnlLineItems(lineKey, from, to);
  if (q.isLoading) return <p className="text-text-muted py-2 text-xs">Loading rows…</p>;
  if (q.isError || q.data === undefined) {
    return (
      <p className="text-danger py-2 text-xs">
        {q.error?.message ?? 'Could not load the rows.'}{' '}
        <button type="button" className="underline" onClick={() => void q.refetch()}>
          Retry
        </button>
      </p>
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
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={`${g.originMonth}-${g.landedMonth}`} className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">{heading(g)}</h3>
            <span className="text-sm">
              Net <Delta amount={g.netInr} /> · {g.count} change{g.count === 1 ? '' : 's'}
            </span>
          </div>
          <Table>
            <THead>
              <Tr>
                <Th>Line</Th>
                <Th align="right">Revenue</Th>
                <Th align="right">Cost</Th>
                <Th align="right">Net</Th>
              </Tr>
            </THead>
            <TBody>
              {g.lines.map((l) => {
                const id = `${g.originMonth}-${g.landedMonth}-${l.lineKey}`;
                const isOpen = open === id;
                return (
                  <Fragment key={id}>
                    <Tr>
                      <Td>
                        <button
                          type="button"
                          className="hover:text-text-bright flex items-center gap-1.5 text-left font-medium"
                          onClick={() => setOpen(isOpen ? null : id)}
                          aria-expanded={isOpen}
                        >
                          <ChevronRight
                            className={`size-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                            aria-hidden
                          />
                          {l.name}
                          <span className="text-text-faint text-xs font-normal">({l.count})</span>
                        </button>
                      </Td>
                      <Td align="right">
                        <Money amount={l.revenueInr} currency="INR" convert={false} />
                      </Td>
                      <Td align="right">
                        <Money amount={l.costInr} currency="INR" convert={false} />
                      </Td>
                      <Td align="right">
                        <Delta amount={l.netInr} />
                      </Td>
                    </Tr>
                    {isOpen && (
                      <Tr>
                        <Td colSpan={4} className="bg-surface-raised">
                          <CarriedRows filter={filterFor(g, l.lineKey)} />
                        </Td>
                      </Tr>
                    )}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>
        </div>
      ))}
    </div>
  );
}

function CarriedRows({ filter }: { readonly filter: CarryForwardFilter }): ReactElement {
  const q = usePnlCarryForwardRows(filter);
  if (q.isLoading) return <p className="text-text-muted py-2 text-xs">Loading changes…</p>;
  if (q.isError || q.data === undefined) {
    return (
      <p className="text-danger py-2 text-xs">
        {q.error?.message ?? 'Could not load the changes.'}{' '}
        <button type="button" className="underline" onClick={() => void q.refetch()}>
          Retry
        </button>
      </p>
    );
  }
  if (q.data.rows.length === 0) {
    return <p className="text-text-faint py-2 text-xs">No changes.</p>;
  }
  return (
    <div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-xs">
          <thead className="text-text-faint sticky top-0 bg-[var(--color-surface-raised)] text-left">
            <tr>
              <th className="py-1 pr-2 font-medium">Record</th>
              <th className="py-1 pr-2 font-medium">What changed</th>
              <th className="py-1 pr-2 font-medium">Found</th>
              <th className="py-1 pr-2 text-right font-medium">Revenue</th>
              <th className="py-1 pr-2 text-right font-medium">Cost</th>
              <th className="py-1 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {q.data.rows.map((r) => (
              <tr key={r.id} className="border-border/60 border-t align-top">
                <td className="py-1 pr-2">
                  <span className="font-mono">{r.ref}</span>
                  {r.subRef !== null && <div className="text-text-faint">{r.subRef}</div>}
                </td>
                <td className="py-1 pr-2">{r.reason}</td>
                <td className="text-text-muted py-1 pr-2 whitespace-nowrap">
                  {istDateLabel(r.detectedAt)}
                </td>
                <td className="py-1 pr-2 text-right">
                  <Money amount={r.revenueDeltaInr} currency="INR" convert={false} />
                </td>
                <td className="py-1 pr-2 text-right">
                  <Money amount={r.costDeltaInr} currency="INR" convert={false} />
                </td>
                <td className="py-1 text-right">
                  <Delta amount={r.netInr} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.data.truncated && (
        <p className="text-warning mt-2 text-xs">
          Only the first {q.data.rows.length} changes are shown.
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
  const backfill = useBackfillPnlClose();
  const [through, setThrough] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<BackfillResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = (dryRun: boolean): void => {
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
        },
        onError: (e) => setError(serverVerdict(e)),
      },
    );
  };

  return (
    <Section title="Close earlier months">
      <Card>
        <CardBody>
          <div className="space-y-3 text-sm">
            <p className="text-text-muted">
              Closes every month with anything on its P&amp;L, oldest first, up to the month you
              choose (last month if left empty) — as each stands right now. Preview shows what would
              be closed and writes nothing.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <FormField label="Through month">
                <Input type="month" value={through} onChange={(e) => setThrough(e.target.value)} />
              </FormField>
              <Button variant="secondary" disabled={backfill.isPending} onClick={() => run(true)}>
                Preview
              </Button>
            </div>
            {error !== null && <p className="text-danger">{error}</p>}
            {result !== null && (
              <>
                <Table>
                  <THead>
                    <Tr>
                      <Th>Month</Th>
                      <Th>{result.dryRun ? 'Would' : 'Result'}</Th>
                      <Th align="right">Net</Th>
                      <Th>Note</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {result.months.length === 0 ? (
                      <Tr>
                        <Td colSpan={4} className="text-text-faint">
                          No month has anything on its P&amp;L up to then.
                        </Td>
                      </Tr>
                    ) : (
                      result.months.map((m) => (
                        <Tr key={m.month}>
                          <Td className="font-mono">{m.month}</Td>
                          <Td>{m.action.replaceAll('_', ' ').toLowerCase()}</Td>
                          <Td align="right">
                            {m.netInr === null ? (
                              '—'
                            ) : (
                              <Money amount={m.netInr} currency="INR" convert={false} />
                            )}
                          </Td>
                          <Td className="text-xs">{m.note ?? ''}</Td>
                        </Tr>
                      ))
                    )}
                  </TBody>
                </Table>
                {result.dryRun && result.months.some((m) => m.action === 'WOULD_CLOSE') && (
                  <div className="space-y-2">
                    <FormField label="Why these months are being closed">
                      <Textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        placeholder="e.g. Starting the carry-forward P&L: closing every month to date"
                      />
                    </FormField>
                    <Button
                      variant="destructive"
                      disabled={backfill.isPending}
                      onClick={() => setConfirming(true)}
                    >
                      Close these months
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title="Close these months for good?"
            description="Their figures are frozen as they stand now. A closed month is never reopened; later changes are carried into the open month."
            confirmLabel="Close them"
            confirmVariant="destructive"
            disabled={backfill.isPending}
            onConfirm={() => {
              setConfirming(false);
              run(false);
            }}
          />
        </CardBody>
      </Card>
    </Section>
  );
}
