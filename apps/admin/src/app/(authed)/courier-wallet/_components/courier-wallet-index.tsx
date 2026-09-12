'use client';

import { useState, type ReactElement } from 'react';
import { AlertTriangle, ArrowDownRight, Wallet } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
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
  StatusBadge,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Textarea,
  Th,
  Tr,
} from '@skydrop/ui/components';
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

  if (accounts.isLoading) return <LoadingState />;
  if (accounts.isError || accounts.data === undefined) {
    return (
      <ErrorState
        message={accounts.error?.message ?? 'Could not read the courier wallets.'}
        retry={() => void accounts.refetch()}
      />
    );
  }

  const rows = accounts.data.accounts;
  const unrecorded = rows.reduce((n, a) => n + a.unrecordedCount, 0);
  const neverArrived = unmatched.data?.payments ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Courier wallets"
        subtitle="Their prepaid balance is our money on somebody else's system. Every rupee in it should have left one of our accounts, and every rupee that left should be in it."
        action={
          mayRecord ? (
            <Button onClick={() => setPaying(true)}>
              <ArrowDownRight className="size-4" /> Record a top-up
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Held at couriers"
          value={
            <Money
              amount={rows.reduce((t, a) => t + Number(a.balanceInr ?? 0), 0).toFixed(2)}
              currency="INR"
              convert={false}
            />
          }
          tone={rows.some((a) => a.balanceInr === null) ? 'warn' : 'neutral'}
          hint={
            rows.some((a) => a.balanceInr === null)
              ? 'Excludes wallets we have never read'
              : 'Prepaid float — an asset, not cash'
          }
        />
        <Stat
          label="Recharges not in our books"
          value={String(unrecorded)}
          tone={unrecorded > 0 ? 'bad' : 'neutral'}
          hint="Money at the courier with no payment of ours behind it"
        />
        <Stat
          label="Paid and never arrived"
          value={String(neverArrived.length)}
          tone={neverArrived.length > 0 ? 'bad' : 'neutral'}
          hint="Left our bank, no matching recharge"
        />
      </div>

      {neverArrived.length > 0 ? (
        <Section
          title="Money that left our bank and never arrived"
          subtitle="Either the reference on our entry is wrong, or the payment did not reach them. Check the bank statement against their recharge list before recording anything else on the account."
        >
          <Card>
            <CardBody className="p-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>Paid from</Th>
                    <Th>Reference</Th>
                    <Th>When</Th>
                    <Th align="right">Amount</Th>
                  </Tr>
                </THead>
                <TBody>
                  {neverArrived.map((p) => (
                    <Tr key={p.bankEntryId}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="text-status-failed-fg size-4" />
                          {p.accountLabel}
                        </div>
                        {p.note === null ? null : (
                          <div className="text-text-muted mt-0.5 text-xs">{p.note}</div>
                        )}
                      </Td>
                      <Td className="font-mono text-xs">{p.reference ?? '—'}</Td>
                      <Td>{new Date(p.occurredAt).toLocaleDateString('en-IN')}</Td>
                      <Td align="right">
                        <Money amount={p.amountInr} currency="INR" convert={false} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </Section>
      ) : null}

      <Section title="Wallets">
        <Card>
          <CardBody className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Account</Th>
                  <Th align="right">Balance</Th>
                  <Th>Last read</Th>
                  <Th align="right">Unreconciled</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.length === 0 ? (
                  <TableEmpty colSpan={4}>No courier accounts yet.</TableEmpty>
                ) : (
                  rows.map((a) => (
                    <Tr key={a.courierAccountId}>
                      <Td>
                        <div className="flex items-center gap-2 font-medium">
                          <Wallet className="text-text-muted size-4" />
                          {a.label}
                        </div>
                        <div className="text-text-muted mt-0.5 text-xs">{a.courierCode}</div>
                      </Td>
                      <Td align="right">
                        {/* Never read is not the same as empty, and only
                            one of the two should worry anybody. */}
                        {a.balanceInr === null ? (
                          <span className="text-text-muted text-xs">Never read</span>
                        ) : (
                          <Money amount={a.balanceInr} currency="INR" convert={false} />
                        )}
                      </Td>
                      <Td className="text-text-muted text-xs">
                        {a.capturedAt === null
                          ? '—'
                          : new Date(a.capturedAt).toLocaleString('en-IN')}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {a.unrecordedCount + a.mismatchCount === 0 ? (
                          <span className="text-text-muted">—</span>
                        ) : (
                          <span className="text-status-failed-fg">
                            {a.unrecordedCount + a.mismatchCount}
                          </span>
                        )}
                      </Td>
                    </Tr>
                  ))
                )}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      </Section>

      <Section
        title="Recharges at the courier"
        subtitle="Matched on the bank's own reference — never on the amount and date, which would pair two identical top-ups arbitrarily and report both as reconciled."
        action={
          <Select
            aria-label="Match state"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="UNRECORDED">Not in our books</option>
            <option value="AMOUNT_MISMATCH">Amounts disagree</option>
            <option value="MATCHED">Matched</option>
            <option value="RESOLVED">Explained</option>
            <option value="ALL">All</option>
          </Select>
        }
      >
        <Card>
          <CardBody className="p-0">
            {recharges.isLoading ? (
              <LoadingState />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Their recharge</Th>
                    <Th>Bank reference</Th>
                    <Th>When</Th>
                    <Th align="right">Amount</Th>
                    <Th>State</Th>
                    <Th />
                  </Tr>
                </THead>
                <TBody>
                  {(recharges.data?.recharges ?? []).length === 0 ? (
                    <TableEmpty colSpan={6}>
                      {filter === 'UNRECORDED'
                        ? 'Every recharge here is accounted for.'
                        : 'Nothing in this state.'}
                    </TableEmpty>
                  ) : (
                    (recharges.data?.recharges ?? []).map((r) => {
                      const tone = matchTone(r.matchState);
                      return (
                        <Tr key={r.id}>
                          <Td>
                            <div className="font-mono text-xs">{r.externalTxnId}</div>
                            <div className="text-text-muted mt-0.5 text-xs">{r.accountLabel}</div>
                          </Td>
                          <Td className="font-mono text-xs">{r.bankTxnRef ?? '—'}</Td>
                          <Td>{new Date(r.occurredAt).toLocaleDateString('en-IN')}</Td>
                          <Td align="right">
                            <Money amount={r.amountInr} currency="INR" convert={false} />
                            {r.bankAmountInr !== null && r.bankAmountInr !== r.amountInr ? (
                              <div className="text-status-failed-fg mt-0.5 text-xs">
                                ours ₹{r.bankAmountInr}
                              </div>
                            ) : null}
                          </Td>
                          <Td>
                            <StatusBadge kind={tone.kind} label={tone.label} />
                            {r.resolutionNote === null ? null : (
                              <div className="text-text-muted mt-0.5 max-w-xs text-xs">
                                {r.resolutionNote}
                              </div>
                            )}
                          </Td>
                          <Td align="right">
                            {r.matchState === 'UNRECORDED' && mayRecord ? (
                              <div className="flex justify-end gap-2">
                                <Button size="sm" onClick={() => setRecording(r)}>
                                  Record payment
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setExplaining(r)}
                                >
                                  Not ours
                                </Button>
                              </div>
                            ) : (
                              <span className="text-text-muted text-xs">
                                {r.bankAccountLabel ?? ''}
                              </span>
                            )}
                          </Td>
                        </Tr>
                      );
                    })
                  )}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </Section>

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
  const [bankAccountId, setBankAccountId] = useState('');
  const [note, setNote] = useState('');
  const m = useRecordRechargeBankSide();
  const inr = banks.filter((b) => b.currency === 'INR');

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Which account paid for this?"
      description={`₹${recharge.amountInr} reached ${recharge.accountLabel} on ${new Date(
        recharge.occurredAt,
      ).toLocaleDateString(
        'en-IN',
      )}. Recording it writes the bank entry and ties the two together — the amount, date and reference come from their row, so there is nothing to mistype.`}
    >
      <div className="space-y-4">
        <FormField label="Paid from" required>
          <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">Choose an account…</option>
            {inr.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Note" hint="Optional — anything worth saying about this payment">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
        {m.isError ? <ErrorState message={serverVerdict(m.error)} /> : null}
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={bankAccountId === '' || m.isPending}
          onClick={() =>
            m.mutate(
              { rechargeId: recharge.id, bankAccountId, ...(note === '' ? {} : { note }) },
              { onSuccess: onClose },
            )
          }
        >
          {m.isPending ? 'Recording…' : 'Record the payment'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function ExplainModal({
  recharge,
  onClose,
}: {
  readonly recharge: CourierRechargeView;
  readonly onClose: () => void;
}): ReactElement {
  const [reason, setReason] = useState('');
  const m = useResolveRecharge();

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="This recharge was not paid for by us"
      description="A credit note, a promotional top-up, a correction they made on their own side. No bank entry is written — there is no money of ours behind it, and inventing one would put a figure in the book no statement will ever agree with."
    >
      <div className="space-y-4">
        <FormField
          label="What was it?"
          required
          hint={`At least 20 characters. This is the only record of why ₹${recharge.amountInr} at the courier has nothing of ours behind it, and it is kept permanently against your name.`}
        >
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        {m.isError ? <ErrorState message={serverVerdict(m.error)} /> : null}
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={reason.trim().length < 20 || m.isPending}
          onClick={() => m.mutate({ rechargeId: recharge.id, reason }, { onSuccess: onClose })}
        >
          {m.isPending ? 'Saving…' : 'Record the explanation'}
        </Button>
      </ModalFooter>
    </Modal>
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
  const [bankAccountId, setBankAccountId] = useState('');
  const [courierAccountId, setCourierAccountId] = useState(accounts[0]?.courierAccountId ?? '');
  const [amountInr, setAmountInr] = useState('');
  const [reference, setReference] = useState('');
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  // Mounted per opening, so this is one key per opening, reused on every
  // retry: a double-click books the top-up once.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const m = useRecordCourierPayment();
  const inr = banks.filter((b) => b.currency === 'INR');
  const ready =
    bankAccountId !== '' && courierAccountId !== '' && amountInr !== '' && reference.trim() !== '';

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Record a wallet top-up"
      description="Record it here at the time you pay it. The nightly check matches this against their own recharge row — if it never appears there, you get told."
    >
      <div className="space-y-4">
        <FormField label="Wallet topped up" required>
          <Select value={courierAccountId} onChange={(e) => setCourierAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.courierAccountId} value={a.courierAccountId}>
                {a.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Paid from" required>
          <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">Choose an account…</option>
            {inr.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Amount (₹)" required>
            <Input
              inputMode="decimal"
              value={amountInr}
              onChange={(e) => setAmountInr(e.target.value)}
              placeholder="20000.00"
            />
          </FormField>
          <FormField label="Date paid" required>
            <Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </FormField>
        </div>
        <FormField
          label="Bank reference"
          required
          hint="What the bank calls this transaction. It is the only thing the two sides are matched on — without it this payment can never be tied to their recharge."
        >
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </FormField>
        {m.isError ? <ErrorState message={serverVerdict(m.error)} /> : null}
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!ready || m.isPending}
          onClick={() =>
            m.mutate(
              {
                bankAccountId,
                courierAccountId,
                amountInr,
                reference,
                occurredAt: new Date(`${occurredAt}T00:00:00Z`).toISOString(),
                idempotencyKey,
              },
              { onSuccess: onClose },
            )
          }
        >
          {m.isPending ? 'Recording…' : 'Record it'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
