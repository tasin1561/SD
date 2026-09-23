'use client';

import { useState, type ReactElement } from 'react';
import { PiggyBank, Receipt, Tags } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Tabs } from '@skydrop/ui/app/tabs';
import { Select } from '@skydrop/ui/app/select';
import { TextField } from '@skydrop/ui/app/text-field';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { Table, TBody, THead, Td, Th, TableEmpty, Tr } from '@skydrop/ui/app/data-table';
import { useToast } from '@skydrop/ui/app/toast';
import {
  useAttributeExpense,
  useBankEntries,
  useExpenseCategories,
  useFreightSearch,
  useInvestments,
  type BankEntryView,
  type FreightChargeView,
} from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { LinkButton, MoSection } from '../../treasury/_components/money-parts';
import { CategoryModal } from './category-modal';
import { ExpenseModal } from './expense-modal';
import { InvestmentModal } from './investment-modal';
import { InvestmentReturnModal } from './investment-return-modal';
import './expenses.css';

type Tab = 'spending' | 'investments';

/**
 * Categories whose costs belong to a LEG rather than to running the
 * business. An entry filed here with nothing attached is counted twice
 * in the P&L — once as that leg's cost, once as operating expenses —
 * so these are the only rows worth offering an Attribute action on.
 */
const LEG_CATEGORIES = new Set(['freight_forwarder', 'courier_charges']);

/**
 * What we spend, and what we have parked.
 *
 * Both are ours — client money is not spendable and not investable —
 * which is why they live together and away from the seller-facing money
 * pages. Both post through the same bank ledger, so an expense paid and
 * a deposit placed both move a real account rather than being noted
 * somewhere off to the side.
 *
 * ── TWO TABS, AND WHAT USED TO BE HERE INSTEAD ───────────────────────
 * They are different questions asked at different times — "what did we
 * spend" is weekly, "what have we placed" is occasional — and stacking
 * them meant scrolling past one to reach the other.
 *
 * Spending opens on the LEDGER, not on the category list. The categories
 * changed a few times a year and the spending changes every week, so the
 * page used to open on a reference table while the thing somebody came
 * to see was below it. They now live at /expenses/categories.
 */
export function ExpensesIndex(): ReactElement {
  const canWrite = usePermission('money.treasury.manage');
  const [tab, setTab] = useState<Tab>('spending');
  const [showClosed, setShowClosed] = useState(false);

  const [spending, setSpending] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [returningTo, setReturningTo] = useState<string | null>(null);

  return (
    <div className="mo-page">
      <PageHeader
        title="Expenses & investments"
        subtitle="What it costs to exist, and what we have parked somewhere it can earn."
        action={
          canWrite ? (
            // The two writes this page exists for, at the top and
            // visibly primary. They were a ghost button next to a
            // category action and easy to miss entirely.
            <div className="mo-row">
              <Button
                variant="primary"
                icon={<Receipt size={16} />}
                onClick={() => setSpending(true)}
              >
                Record an expense
              </Button>
              <Button
                variant="secondary"
                icon={<PiggyBank size={16} />}
                onClick={() => setPlacing(true)}
              >
                Place capital
              </Button>
            </div>
          ) : undefined
        }
      />

      <Tabs
        label="Expenses and investments"
        value={tab}
        onChange={(id) => setTab(id === 'investments' ? 'investments' : 'spending')}
        items={[
          {
            id: 'spending',
            label: 'Spending',
            panel: (
              <SpendingTab onNewCategory={() => setAddingCategory(true)} canWrite={canWrite} />
            ),
          },
          {
            id: 'investments',
            label: 'Investments',
            panel: (
              <InvestmentsTab
                showClosed={showClosed}
                setShowClosed={setShowClosed}
                canWrite={canWrite}
                onRecordReturn={setReturningTo}
              />
            ),
          },
        ]}
      />

      <CategoryModal open={addingCategory} onOpenChange={setAddingCategory} />
      <ExpenseModal open={spending} onOpenChange={setSpending} />
      <InvestmentModal open={placing} onOpenChange={setPlacing} />
      <InvestmentReturnModal investmentId={returningTo} onClose={() => setReturningTo(null)} />
    </div>
  );
}

/**
 * Every expense, newest first — the ledger, not a summary.
 *
 * A total nobody can open is a total nobody can check, and until now
 * this page could show what a spend might be FILED as without ever
 * showing a spend. Each row carries who recorded it and when they did,
 * which is a different fact from when the money moved: an entry dated
 * Tuesday may have been typed in on Friday, and only one of those
 * answers "who do I ask about this line".
 */
function SpendingTab({
  onNewCategory,
  canWrite,
}: {
  readonly onNewCategory: () => void;
  readonly canWrite: boolean;
}): ReactElement {
  const [categoryId, setCategoryId] = useState('');
  const [attributing, setAttributing] = useState<BankEntryView | null>(null);
  const onAttribute = setAttributing;
  const categories = useExpenseCategories(false);
  const entries = useBankEntries({
    type: 'EXPENSE',
    limit: 200,
    ...(categoryId === '' ? {} : { expenseCategoryId: categoryId }),
  });

  const items = entries.data?.items ?? [];
  const total = items.reduce((t, e) => t + Math.abs(Number(e.signedAmount)), 0);

  return (
    <MoSection
      title="Spending ledger"
      note="Every expense recorded, newest first. Filed against a category so a quarter can be broken down rather than read as one number."
      flush
      action={
        <div className="mo-row">
          <Select
            label="Category"
            className="ex-filter"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Every category</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <LinkButton
            href="/expenses/categories"
            variant="ghost"
            size="sm"
            icon={<Tags size={14} />}
          >
            Categories
          </LinkButton>
          {canWrite && (
            <Button variant="ghost" size="sm" onClick={onNewCategory}>
              New category
            </Button>
          )}
        </div>
      }
    >
      {entries.isLoading ? (
        <div className="mo-card__pad">
          <SkeletonRows rows={6} cols={7} label="Loading the spending ledger" />
        </div>
      ) : entries.isError || entries.data === undefined ? (
        <div className="mo-card__pad">
          <ErrorState
            message={entries.error?.message ?? 'Could not read the spending ledger.'}
            retry={() => void entries.refetch()}
          />
        </div>
      ) : (
        <>
          <div className="mo-card__pad ex-summary">
            <span className="ex-summary__count sk-figure">
              {items.length} {items.length === 1 ? 'entry' : 'entries'} shown
              {categoryId === '' ? '' : ' in this category'}
            </span>
            {/* The sum of what is ON SCREEN, said so plainly. A total
                that silently covered more rows than are listed would
                be unverifiable by counting. */}
            <span>
              Total shown <Money amount={total.toFixed(2)} currency="INR" convert={false} />
            </span>
          </div>

          <Table>
            <THead>
              <Tr>
                <Th>When it moved</Th>
                <Th>Category</Th>
                <Th>Paid from</Th>
                <Th align="right">Amount</Th>
                <Th>Reference</Th>
                <Th>Recorded by</Th>
                <Th align="right">Consignment</Th>
              </Tr>
            </THead>
            <TBody>
              {items.length === 0 ? (
                <TableEmpty colSpan={7}>
                  {categoryId === '' ? (
                    <EmptyState
                      bare
                      title="Nothing recorded yet."
                      description="Every expense paid from one of our accounts appears here."
                    />
                  ) : (
                    <EmptyState bare title="Nothing filed under this category yet." />
                  )}
                </TableEmpty>
              ) : (
                items.map((e) => (
                  <Tr key={e.id}>
                    <Td className="mo-nowrap sk-figure">
                      {new Date(e.occurredAt).toLocaleDateString('en-IN')}
                      {e.note !== null && <span className="ex-note">{e.note}</span>}
                    </Td>
                    <Td>
                      {e.categoryName === null ? (
                        // Not "—": an uncategorised cost is a real gap in
                        // the breakdown and should look like one.
                        <StatusChip size="sm" kind="pending" label="Uncategorised" />
                      ) : (
                        <span>{e.categoryName}</span>
                      )}
                    </Td>
                    <Td className="mo-muted">{e.accountLabel}</Td>
                    <Td align="right">
                      <Money
                        amount={Math.abs(Number(e.signedAmount)).toFixed(2)}
                        currency={e.currency}
                        convert={false}
                        direction="debit"
                      />
                    </Td>
                    <Td className="ex-ref sk-ident">{e.reference ?? '—'}</Td>
                    <Td className="mo-muted">
                      {/* "System" rather than blank: a flow writing an
                          entry and nobody recording it are different
                          facts, and only one of them is a gap. */}
                      {e.recordedByName ?? 'System'}
                      <span className="mo-sub sk-figure">
                        {new Date(e.recordedAt).toLocaleDateString('en-IN')}
                      </span>
                    </Td>
                    <Td align="right">
                      {e.inboundFreightChargeId !== null ? (
                        <span className="ex-attributed">Attributed</span>
                      ) : LEG_CATEGORIES.has(e.categoryCode ?? '') && canWrite ? (
                        // Offered only on the categories where leaving
                        // it unattached is an actual double count. On
                        // rent or software there is no leg to attach to.
                        <Button variant="ghost" size="sm" onClick={() => onAttribute(e)}>
                          Attribute
                        </Button>
                      ) : (
                        <span className="mo-faint">—</span>
                      )}
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        </>
      )}

      {attributing !== null && (
        <AttributeModal entry={attributing} onClose={() => setAttributing(null)} />
      )}
    </MoSection>
  );
}

/**
 * Attach an already-recorded expense to the consignment it paid for.
 *
 * The bill is found by searching, because the person doing this is
 * holding a forwarder's invoice and what is printed on it is a
 * consignment number — not a row in a dropdown of every open bill.
 */
function AttributeModal({
  entry,
  onClose,
}: {
  readonly entry: BankEntryView;
  readonly onClose: () => void;
}): ReactElement {
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<FreightChargeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const results = useFreightSearch(term);
  const attribute = useAttributeExpense();
  const toast = useToast();
  const amount = Math.abs(Number(entry.signedAmount)).toFixed(2);
  // A non-INR payment is priced in rupees by the server, at the rate in
  // force when it moved — the consignment's cost is the sum of those.
  const needsInr = entry.currency !== 'INR';

  async function save(): Promise<void> {
    setError(null);
    if (picked === null) {
      setError('Find the consignment this paid for');
      // Nothing was sent; the confirm stays open on the message.
      throw new Error('no consignment picked');
    }
    try {
      await attribute.mutateAsync({
        freightChargeId: picked.id,
        bankEntryId: entry.id,
      });
      onClose();
      toast.success('Expense attached to the consignment');
    } catch (err) {
      setError(serverVerdict(err));
      throw err;
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Attach this to a consignment"
      entity={`From ${entry.accountLabel}`}
      amount={<Money amount={amount} currency={entry.currency} convert={false} direction="debit" />}
      consequence="Attaching it moves the cost out of operating expenses and into that consignment's leg — where it is currently being counted twice."
      confirmLabel="Attach"
      onConfirm={save}
      error={error ?? undefined}
    >
      <div className="mo-fields">
        {picked === null ? (
          <TextField
            label="Which consignment"
            requiredMark
            hint="Search by consignment number, receipt or seller."
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="e.g. CN-2026-08"
            autoFocus
            after={
              term.trim().length >= 2 ? (
                <div className="ex-results">
                  {results.isLoading ? (
                    <p className="ex-results__note">Searching…</p>
                  ) : (results.data ?? []).length === 0 ? (
                    <p className="ex-results__note">No freight bill matches that.</p>
                  ) : (
                    (results.data ?? []).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className="ex-result"
                        onClick={() => setPicked(f)}
                      >
                        <span className="ex-result__title sk-ident">
                          {f.consignmentNumber ?? 'Consignment'}
                        </span>
                        <span className="ex-result__sub">
                          {f.sellerCompanyName ?? ''} · billed {f.totalInr}
                          {f.ourCostInr === null
                            ? ' · no cost recorded'
                            : ` · cost ${f.ourCostInr}`}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : undefined
            }
          />
        ) : (
          <div>
            <p className="ex-picked__label">Attaching to</p>
            <div className="ex-picked">
              <div className="mo-wrap">
                <div className="ex-picked__title sk-ident">
                  {picked.consignmentNumber ?? 'Consignment'}
                </div>
                <div className="ex-picked__sub">
                  {picked.sellerCompanyName ?? ''} · billed {picked.totalInr}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
                Change
              </Button>
            </div>
          </div>
        )}

        {needsInr && (
          <p className="mo-faint">
            Paid in {entry.currency}. It is priced in rupees at the rate recorded for the day it
            moved, and the consignment&apos;s cost becomes the sum of every payment against it.
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}

function InvestmentsTab({
  showClosed,
  setShowClosed,
  canWrite,
  onRecordReturn,
}: {
  readonly showClosed: boolean;
  readonly setShowClosed: (next: boolean) => void;
  readonly canWrite: boolean;
  readonly onRecordReturn: (id: string) => void;
}): ReactElement {
  const investments = useInvestments(showClosed);

  return (
    <MoSection
      title="Investments"
      note="Capital placed where it can earn. It leaves the bank without being spent, so client-money coverage still reads correctly while it is out."
      flush
      action={
        <Checkbox
          checked={showClosed}
          onChange={(e) => setShowClosed(e.target.checked)}
          label="Show closed"
        />
      }
    >
      {investments.isLoading ? (
        <div className="mo-card__pad">
          <SkeletonRows rows={4} cols={7} label="Loading investments" />
        </div>
      ) : investments.isError || investments.data === undefined ? (
        <div className="mo-card__pad">
          <ErrorState
            message={investments.error?.message ?? 'Could not read the investments.'}
            retry={() => void investments.refetch()}
          />
        </div>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>What</Th>
              <Th>With</Th>
              <Th align="right">Placed</Th>
              <Th align="right">Returned</Th>
              <Th align="right">Net</Th>
              <Th>State</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {investments.data.length === 0 ? (
              <TableEmpty colSpan={7}>
                <EmptyState
                  bare
                  title="Nothing placed."
                  description="A fixed deposit or a loan out is recorded here so it stops reading as money that vanished."
                />
              </TableEmpty>
            ) : (
              investments.data.map((i) => (
                <Tr key={i.id}>
                  <Td>{i.label}</Td>
                  <Td className="mo-muted">{i.counterparty}</Td>
                  <Td align="right">
                    <Money amount={i.placed} currency={i.currency} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money amount={i.returned} currency={i.currency} convert={false} />
                  </Td>
                  <Td align="right">
                    <Money
                      amount={i.net}
                      currency={i.currency}
                      convert={false}
                      direction={Number(i.net) < 0 ? 'debit' : 'credit'}
                    />
                  </Td>
                  <Td>
                    <StatusChip
                      size="sm"
                      kind={i.closedAt === null ? 'in-transit' : 'delivered'}
                      label={i.closedAt === null ? 'Out' : 'Closed'}
                    />
                  </Td>
                  <Td align="right">
                    {canWrite && i.closedAt === null ? (
                      <Button variant="ghost" size="sm" onClick={() => onRecordReturn(i.id)}>
                        Record return
                      </Button>
                    ) : (
                      <span className="mo-faint">—</span>
                    )}
                  </Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      )}
    </MoSection>
  );
}
