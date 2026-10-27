'use client';

import { useState, type ReactElement } from 'react';
import { AlertTriangle, ArrowDownRight, Wallet } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TBody, THead, Table, TableEmpty, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { DateField } from '@skydrop/ui/app/date-field';
import { useToast } from '@skydrop/ui/app/toast';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { usePlatformBankAccounts } from '@/lib/bank-account-hooks';
import {
  useCourierRecharges,
  useCourierWalletAccounts,
  useRecordCourierPayment,
  useRecordRechargeBankSide,
  useResolveRecharge,
  useUnmatchedCourierPayments,
  type CourierRechargeView,
} from '@/lib/ops-hooks';
import { MoSection } from '../../treasury/_components/money-parts';
import './courier-wallet.css';
import { useT } from '@/i18n/client';

/**
 * The courier's prepaid wallet, against our own bank.
 *
 * Two questions, and they are NOT the same question asked twice:
 *
 *   Did every rupee in their wallet come out of one of our accounts?
 *   (An unrecorded recharge is either a forgotten entry or somebody
 *   else's money.)
 *
 *   Did every rupee we booked as a recharge actually reach them?
 *   (Money leaving the treasury under a plausible label and arriving
 *   nowhere is what this page exists to make impossible to miss.)
 *
 * The second is the more serious and is listed FIRST, above the fold,
 * even though it is almost always empty. A section that is usually empty
 * and occasionally holds a theft is worth the space it costs.
 */
function matchTone(state: CourierRechargeView['matchState']): {
  label: string;
  kind: 'delivered' | 'pending' | 'failed' | 'confirmed';
} {
  switch (state) {
    case 'MATCHED':
      return { label: 'Matched', kind: 'delivered' };
    case 'UNRECORDED':
      return { label: 'Not in our books', kind: 'failed' };
    case 'AMOUNT_MISMATCH':
      return { label: 'Amounts disagree', kind: 'failed' };
    case 'RESOLVED':
      return { label: 'Explained', kind: 'confirmed' };
  }
}

export function CourierWalletIndex(): ReactElement {
  const tr = useT();
  const [filter, setFilter] = useState<string>('UNRECORDED');
  const accounts = useCourierWalletAccounts();
  const recharges = useCourierRecharges(filter === 'ALL' ? undefined : filter);
  const unmatched = useUnmatchedCourierPayments();
  // FE-2 cosmetic, and one thing more: recording a payment needs
  // `money.treasury.manage` and the bank-account list needs
  // `money.view`, both NARROWER than this page's own gate. Sending a
  // request nobody may make would 403 on load and read as a broken page
  // to somebody who did nothing wrong.
  const mayRecord = usePermission('money.treasury.manage');
  // Both read unconditionally: `a && usePermission(b)` short-circuits,
  // which skips a hook call and changes the hook ORDER between renders.
  const mayReadBanks = usePermission('money.view');
  const banks = usePlatformBankAccounts(mayRecord && mayReadBanks);

  const [recording, setRecording] = useState<CourierRechargeView | null>(null);
  const [explaining, setExplaining] = useState<CourierRechargeView | null>(null);
  const [paying, setPaying] = useState(false);

  if (accounts.isLoading) {
    return (
      <div className="mo-page">
        <div className="mo-kpis">
          <Skeleton height={112} rounded="md" />
          <Skeleton height={112} rounded="md" />
          <Skeleton height={112} rounded="md" />
        </div>
        <SkeletonRows rows={4} cols={4} />
      </div>
    );
  }
  if (accounts.isError || accounts.data === undefined) {
    return (
      <ErrorState
        message={
          accounts.error?.message ?? tr('courierWalletCourierWalletIndex.couldNotReadTheCourier')
        }
        retry={() => void accounts.refetch()}
      />
    );
  }

  const rows = accounts.data.accounts;
  const unrecorded = rows.reduce((n, a) => n + a.unrecordedCount, 0);
  const neverArrived = unmatched.data?.payments ?? [];

  return (
    <div className="mo-page">
      <PageHeader
        title={tr('courierWalletCourierWalletIndex.courierWallets')}
        subtitle={tr('courierWalletCourierWalletIndex.theirPrepaidBalanceIsOur')}
        action={
          mayRecord ? (
            <Button
              variant="primary"
              icon={<ArrowDownRight size={16} />}
              onClick={() => setPaying(true)}
            >
              {tr('courierWalletCourierWalletIndex.recordATopUp')}
            </Button>
          ) : undefined
        }
      />

      <div className="mo-kpis">
        <KpiCard
          label={tr('courierWalletCourierWalletIndex.heldAtCouriers')}
          figure={
            <Money
              amount={rows.reduce((t, a) => t + Number(a.balanceInr ?? 0), 0).toFixed(2)}
              currency="INR"
              convert={false}
            />
          }
          tone={rows.some((a) => a.balanceInr === null) ? 'pending' : 'neutral'}
          hint={
            rows.some((a) => a.balanceInr === null)
              ? tr('courierWalletCourierWalletIndex.excludesWalletsWeHaveNever')
              : tr('courierWalletCourierWalletIndex.prepaidFloatAnAssetNot')
          }
        />
        <KpiCard
          label={tr('courierWalletCourierWalletIndex.rechargesNotInOurBooks')}
          value={unrecorded}
          tone={unrecorded > 0 ? 'debit' : 'neutral'}
          hint={tr('courierWalletCourierWalletIndex.moneyAtTheCourierWith')}
        />
        <KpiCard
          label={tr('courierWalletCourierWalletIndex.paidAndNeverArrived')}
          value={neverArrived.length}
          tone={neverArrived.length > 0 ? 'debit' : 'neutral'}
          hint={tr('courierWalletCourierWalletIndex.leftOurBankNoMatching')}
        />
      </div>

      {neverArrived.length > 0 ? (
        <MoSection
          title={tr('courierWalletCourierWalletIndex.moneyThatLeftOurBank')}
          note={tr('courierWalletCourierWalletIndex.eitherTheReferenceOnOur')}
          tone="critical"
          flush
        >
          <Table caption={tr('courierWalletCourierWalletIndex.moneyThatLeftOurBank')}>
            <THead>
              <Tr>
                <Th>{tr('courierWalletCourierWalletIndex.paidFrom')}</Th>
                <Th>{tr('courierWalletCourierWalletIndex.reference')}</Th>
                <Th>{tr('courierWalletCourierWalletIndex.when')}</Th>
                <Th align="right">{tr('courierWalletCourierWalletIndex.amount')}</Th>
              </Tr>
            </THead>
            <TBody>
              {neverArrived.map((p) => (
                <Tr key={p.bankEntryId}>
                  <Td>
                    <span className="cw-name" data-tone="bad">
                      <AlertTriangle size={16} aria-hidden />
                      {p.accountLabel}
                    </span>
                    {p.note === null ? null : <span className="cw-note">{p.note}</span>}
                  </Td>
                  <Td>
                    <span className="sk-ident cw-ident">{p.reference ?? '—'}</span>
                  </Td>
                  <Td>{new Date(p.occurredAt).toLocaleDateString('en-IN')}</Td>
                  <Td align="right">
                    <Money amount={p.amountInr} currency="INR" convert={false} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </MoSection>
      ) : null}

      <MoSection title={tr('courierWalletCourierWalletIndex.wallets')} flush>
        <Table caption={tr('courierWalletCourierWalletIndex.courierWallets')}>
          <THead>
            <Tr>
              <Th>{tr('courierWalletCourierWalletIndex.account')}</Th>
              <Th align="right">{tr('courierWalletCourierWalletIndex.balance')}</Th>
              <Th>{tr('courierWalletCourierWalletIndex.lastRead')}</Th>
              <Th align="right">{tr('courierWalletCourierWalletIndex.unreconciled')}</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={4}>
                {tr('courierWalletCourierWalletIndex.noCourierAccountsYet')}
              </TableEmpty>
            ) : (
              rows.map((a) => (
                <Tr key={a.courierAccountId}>
                  <Td>
                    <span className="cw-name">
                      <Wallet size={16} aria-hidden />
                      {a.label}
                    </span>
                    <span className="mo-sub">{a.courierCode}</span>
                  </Td>
                  <Td align="right">
                    {/* Never read is not the same as empty, and only
                        one of the two should worry anybody. */}
                    {a.balanceInr === null ? (
                      <span className="mo-muted">
                        {tr('courierWalletCourierWalletIndex.neverRead')}
                      </span>
                    ) : (
                      <Money amount={a.balanceInr} currency="INR" convert={false} />
                    )}
                  </Td>
                  <Td>
                    <span className="mo-muted">
                      {a.capturedAt === null ? '—' : new Date(a.capturedAt).toLocaleString('en-IN')}
                    </span>
                  </Td>
                  <Td align="right" className="mo-num">
                    {a.unrecordedCount + a.mismatchCount === 0 ? (
                      <span className="mo-muted">—</span>
                    ) : (
                      <span className="mo-bad">{a.unrecordedCount + a.mismatchCount}</span>
                    )}
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </MoSection>

      <MoSection
        title={tr('courierWalletCourierWalletIndex.rechargesAtTheCourier')}
        note={tr('courierWalletCourierWalletIndex.matchedOnTheBankS')}
        action={
          <Select
            label={tr('courierWalletCourierWalletIndex.matchState')}
            className="cw-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="UNRECORDED">
              {tr('courierWalletCourierWalletIndex.notInOurBooks')}
            </option>
            <option value="AMOUNT_MISMATCH">
              {tr('courierWalletCourierWalletIndex.amountsDisagree')}
            </option>
            <option value="MATCHED">{tr('courierWalletCourierWalletIndex.matched')}</option>
            <option value="RESOLVED">{tr('courierWalletCourierWalletIndex.explained')}</option>
            <option value="ALL">{tr('courierWalletCourierWalletIndex.all')}</option>
          </Select>
        }
        flush
      >
        {recharges.isLoading ? (
          <SkeletonRows rows={4} cols={6} />
        ) : (
          <Table caption={tr('courierWalletCourierWalletIndex.rechargesAtTheCourier')}>
            <THead>
              <Tr>
                <Th>{tr('courierWalletCourierWalletIndex.theirRecharge')}</Th>
                <Th>{tr('courierWalletCourierWalletIndex.bankReference')}</Th>
                <Th>{tr('courierWalletCourierWalletIndex.when')}</Th>
                <Th align="right">{tr('courierWalletCourierWalletIndex.amount')}</Th>
                <Th>{tr('courierWalletCourierWalletIndex.state')}</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {(recharges.data?.recharges ?? []).length === 0 ? (
                <TableEmpty colSpan={6}>
                  {filter === 'UNRECORDED'
                    ? tr('courierWalletCourierWalletIndex.everyRechargeHereIsAccounted')
                    : tr('courierWalletCourierWalletIndex.nothingInThisState')}
                </TableEmpty>
              ) : (
                (recharges.data?.recharges ?? []).map((r) => {
                  const tone = matchTone(r.matchState);
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <span className="sk-ident cw-ident">{r.externalTxnId}</span>
                        <span className="mo-sub">{r.accountLabel}</span>
                      </Td>
                      <Td>
                        <span className="sk-ident cw-ident">{r.bankTxnRef ?? '—'}</span>
                      </Td>
                      <Td>{new Date(r.occurredAt).toLocaleDateString('en-IN')}</Td>
                      <Td align="right">
                        <Money amount={r.amountInr} currency="INR" convert={false} />
                        {r.bankAmountInr !== null && r.bankAmountInr !== r.amountInr ? (
                          <span className="mo-sub mo-bad">
                            ours <Money amount={r.bankAmountInr} currency="INR" convert={false} />
                          </span>
                        ) : null}
                      </Td>
                      <Td>
                        <StatusChip kind={tone.kind} label={tone.label} size="sm" />
                        {r.resolutionNote === null ? null : (
                          <span className="cw-note">{r.resolutionNote}</span>
                        )}
                      </Td>
                      <Td align="right">
                        {r.matchState === 'UNRECORDED' && mayRecord ? (
                          <div className="cw-actions">
                            <Button size="sm" variant="primary" onClick={() => setRecording(r)}>
                              {tr('courierWalletCourierWalletIndex.recordPayment')}
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setExplaining(r)}>
                              {tr('courierWalletCourierWalletIndex.notOurs')}
                            </Button>
                          </div>
                        ) : (
                          <span className="mo-muted">{r.bankAccountLabel ?? ''}</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })
              )}
            </TBody>
          </Table>
        )}
      </MoSection>

      {recording === null ? null : (
        <RecordBankSideModal
          recharge={recording}
          banks={banks.data ?? []}
          onClose={() => setRecording(null)}
        />
      )}
      {explaining === null ? null : (
        <ExplainModal recharge={explaining} onClose={() => setExplaining(null)} />
      )}
      {paying ? (
        <RecordPaymentModal
          banks={banks.data ?? []}
          accounts={rows}
          onClose={() => setPaying(false)}
        />
      ) : null}
    </div>
  );
}

function RecordBankSideModal({
  recharge,
  banks,
  onClose,
}: {
  readonly recharge: CourierRechargeView;
  readonly banks: ReadonlyArray<{ id: string; label: string; currency: string }>;
  readonly onClose: () => void;
}): ReactElement {
  const tr = useT();
  const [bankAccountId, setBankAccountId] = useState('');
  const [note, setNote] = useState('');
  const m = useRecordRechargeBankSide();
  const toast = useToast();
  const inr = banks.filter((b) => b.currency === 'INR');

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      locked={m.isPending}
      icon={<Wallet size={18} />}
      title={tr('courierWalletCourierWalletIndex.whichAccountPaidForThis')}
      description={tr('courierWalletCourierWalletIndex.reachedOnRecordingItWrites', {
        amountInr: recharge.amountInr,
        accountLabel: recharge.accountLabel,
        value: new Date(recharge.occurredAt).toLocaleDateString('en-IN'),
      })}
      footer={
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={m.isPending}>
            {tr('courierWalletCourierWalletIndex.cancel')}
          </Button>
          <AsyncButton
            disabled={bankAccountId === ''}
            labels={{
              idle: tr('courierWalletCourierWalletIndex.recordThePayment'),
              busy: tr('courierWalletCourierWalletIndex.recording'),
              done: tr('courierWalletCourierWalletIndex.recorded'),
            }}
            onAction={async () => {
              await m.mutateAsync({
                rechargeId: recharge.id,
                bankAccountId,
                ...(note === '' ? {} : { note }),
              });
              toast.success(
                tr('courierWalletCourierWalletIndex.paymentRecordedAgainstTheirRecharge'),
              );
              onClose();
            }}
          />
        </DialogFooter>
      }
    >
      <div className="mo-fields">
        <Select
          label={tr('courierWalletCourierWalletIndex.paidFrom')}
          requiredMark
          value={bankAccountId}
          onChange={(e) => setBankAccountId(e.target.value)}
        >
          <option value="">{tr('courierWalletCourierWalletIndex.chooseAnAccount')}</option>
          {inr.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </Select>
        <TextField
          label={tr('courierWalletCourierWalletIndex.note')}
          hint={tr('courierWalletCourierWalletIndex.optionalAnythingWorthSayingAbout')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {m.isError ? <ErrorState message={serverVerdict(m.error)} /> : null}
      </div>
    </Dialog>
  );
}

function ExplainModal({
  recharge,
  onClose,
}: {
  readonly recharge: CourierRechargeView;
  readonly onClose: () => void;
}): ReactElement {
  const tr = useT();
  const [reason, setReason] = useState('');
  const m = useResolveRecharge();
  const toast = useToast();

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      locked={m.isPending}
      tone="critical"
      icon={<AlertTriangle size={18} />}
      title={tr('courierWalletCourierWalletIndex.thisRechargeWasNotPaid')}
      description={tr('courierWalletCourierWalletIndex.aCreditNoteAPromotional')}
      footer={
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={m.isPending}>
            {tr('courierWalletCourierWalletIndex.cancel')}
          </Button>
          <AsyncButton
            variant="destructive"
            disabled={reason.trim().length < 20}
            labels={{
              idle: tr('courierWalletCourierWalletIndex.recordTheExplanation'),
              busy: tr('courierWalletCourierWalletIndex.saving'),
              done: tr('courierWalletCourierWalletIndex.saved'),
            }}
            onAction={async () => {
              await m.mutateAsync({ rechargeId: recharge.id, reason });
              toast.success(tr('courierWalletCourierWalletIndex.explanationRecorded'));
              onClose();
            }}
          />
        </DialogFooter>
      }
    >
      <div className="mo-fields">
        <TextArea
          label={tr('courierWalletCourierWalletIndex.whatWasIt')}
          requiredMark
          hint={tr('courierWalletCourierWalletIndex.atLeast20CharactersThis', {
            amountInr: recharge.amountInr,
          })}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {m.isError ? <ErrorState message={serverVerdict(m.error)} /> : null}
      </div>
    </Dialog>
  );
}

function RecordPaymentModal({
  banks,
  accounts,
  onClose,
}: {
  readonly banks: ReadonlyArray<{ id: string; label: string; currency: string }>;
  readonly accounts: ReadonlyArray<{ courierAccountId: string; label: string }>;
  readonly onClose: () => void;
}): ReactElement {
  const tr = useT();
  const [bankAccountId, setBankAccountId] = useState('');
  const [courierAccountId, setCourierAccountId] = useState(accounts[0]?.courierAccountId ?? '');
  const [amountInr, setAmountInr] = useState('');
  const [reference, setReference] = useState('');
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  // Mounted per opening, so this is one key per opening, reused on every
  // retry: a double-click books the top-up once.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = useRecordCourierPayment();
  const toast = useToast();
  const inr = banks.filter((b) => b.currency === 'INR');
  const ready =
    bankAccountId !== '' && courierAccountId !== '' && amountInr !== '' && reference.trim() !== '';

  const walletLabel =
    accounts.find((a) => a.courierAccountId === courierAccountId)?.label ??
    tr('courierWalletCourierWalletIndex.courierWallet');
  const bankLabel =
    inr.find((b) => b.id === bankAccountId)?.label ??
    tr('courierWalletCourierWalletIndex.ourAccount');

  // The confirm sends exactly what the form's button used to send, with
  // the same key — a retry after a refusal still books the top-up once.
  async function send(): Promise<void> {
    setError(null);
    try {
      await m.mutateAsync({
        bankAccountId,
        courierAccountId,
        amountInr,
        reference,
        occurredAt: new Date(`${occurredAt}T00:00:00Z`).toISOString(),
        idempotencyKey,
      });
      toast.success(tr('courierWalletCourierWalletIndex.topUpRecorded'));
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
      throw err;
    }
  }

  return (
    <>
      <Dialog
        open={!confirming}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        icon={<ArrowDownRight size={18} />}
        title={tr('courierWalletCourierWalletIndex.recordAWalletTopUp')}
        description={tr('courierWalletCourierWalletIndex.recordItHereAtThe')}
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {tr('courierWalletCourierWalletIndex.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!ready || m.isPending}
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              {tr('courierWalletCourierWalletIndex.recordIt')}
            </Button>
          </DialogFooter>
        }
      >
        <div className="mo-fields" data-cols="2">
          <Select
            label={tr('courierWalletCourierWalletIndex.walletToppedUp')}
            requiredMark
            className="mo-span-2"
            value={courierAccountId}
            onChange={(e) => setCourierAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.courierAccountId} value={a.courierAccountId}>
                {a.label}
              </option>
            ))}
          </Select>
          <Select
            label={tr('courierWalletCourierWalletIndex.paidFrom')}
            requiredMark
            className="mo-span-2"
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
          >
            <option value="">{tr('courierWalletCourierWalletIndex.chooseAnAccount')}</option>
            {inr.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </Select>
          <TextField
            label={tr('courierWalletCourierWalletIndex.amount2')}
            requiredMark
            inputMode="decimal"
            value={amountInr}
            onChange={(e) => setAmountInr(e.target.value)}
            placeholder="20000.00"
          />
          <DateField
            label={tr('courierWalletCourierWalletIndex.datePaid')}
            requiredMark
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
          <TextField
            label={tr('courierWalletCourierWalletIndex.bankReference')}
            requiredMark
            className="mo-span-2"
            hint={tr('courierWalletCourierWalletIndex.whatTheBankCallsThis')}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          {m.isError && !confirming ? (
            <ErrorState className="mo-span-2" message={serverVerdict(m.error)} />
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => {
          setConfirming(o);
          if (!o) setError(null);
        }}
        title={tr('courierWalletCourierWalletIndex.recordThisWalletTopUp')}
        entity={walletLabel}
        amount={<Money amount={amountInr} currency="INR" convert={false} />}
        consequence={tr('courierWalletCourierWalletIndex.paidFromOnBankReference', {
          bankLabel,
          occurredAt,
          value: reference.trim(),
        })}
        confirmLabel={tr('courierWalletCourierWalletIndex.recordIt')}
        onConfirm={send}
        closeOnSuccess={false}
        error={error ?? undefined}
      />
    </>
  );
}
