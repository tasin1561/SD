'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { PiggyBank, Receipt, Tags } from 'lucide-react';
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
  StatusBadge,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
} from '@skydrop/ui/components';
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
import { CategoryModal } from './category-modal';
import { ExpenseModal } from './expense-modal';
import { InvestmentModal } from './investment-modal';
import { InvestmentReturnModal } from './investment-return-modal';

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
    <div className="space-y-4">
      <PageHeader
        title="Expenses & investments"
        subtitle="What it costs to exist, and what we have parked somewhere it can earn."
        action={
          canWrite ? (
            // The two writes this page exists for, at the top and
            // visibly primary. They were a ghost button next to a
            // category action and easy to miss entirely.
            <div className="flex flex-wrap gap-2">
              <Button size="md" onClick={() => setSpending(true)}>
                <Receipt className="size-4" /> Record an expense
              </Button>
              <Button size="md" variant="secondary" onClick={() => setPlacing(true)}>
                <PiggyBank className="size-4" /> Place capital
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="border-border flex gap-1 border-b" role="tablist">
        <TabButton active={tab === 'spending'} onClick={() => setTab('spending')}>
          Spending
        </TabButton>
        <TabButton active={tab === 'investments'} onClick={() => setTab('investments')}>
          Investments
        </TabButton>
      </div>

      {tab === 'spending' ? (
        <SpendingTab onNewCategory={() => setAddingCategory(true)} canWrite={canWrite} />
      ) : (
        <InvestmentsTab
          showClosed={showClosed}
          setShowClosed={setShowClosed}
          canWrite={canWrite}
          onRecordReturn={setReturningTo}
        />
      )}

      <CategoryModal open={addingCategory} onOpenChange={setAddingCategory} />
      <ExpenseModal open={spending} onOpenChange={setSpending} />
      <InvestmentModal open={placing} onOpenChange={setPlacing} />
      <InvestmentReturnModal investmentId={returningTo} onClose={() => setReturningTo(null)} />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactElement | string;
}): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-accent-fill text-text-bright'
          : 'text-text-muted hover:text-text border-transparent'
      }`}
    >
      {children}
    </button>
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
    <Section
      title="Spending ledger"
      subtitle="Every expense recorded, newest first. Filed against a category so a quarter can be broken down rather than read as one number."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Category"
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
          <Link href="/expenses/categories">
            <Button variant="ghost" size="sm">
              <Tags className="size-3.5" /> Categories
            </Button>
          </Link>
          {canWrite && (
            <Button variant="ghost" size="sm" onClick={onNewCategory}>
              New category
            </Button>
          )}
        </div>
      }
    >
      {entries.isLoading ? (
        <LoadingState />
      ) : entries.isError || entries.data === undefined ? (
        <ErrorState
          message={entries.error?.message ?? 'Could not read the spending ledger.'}
          retry={() => void entries.refetch()}
        />
      ) : (
        <>
          <Card>
            <CardBody className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-text-muted text-sm">
                {items.length} {items.length === 1 ? 'entry' : 'entries'} shown
                {categoryId === '' ? '' : ' in this category'}
              </span>
              {/* The sum of what is ON SCREEN, said so plainly. A total
                  that silently covered more rows than are listed would
                  be unverifiable by counting. */}
              <span className="text-sm">
                Total shown <Money amount={total.toFixed(2)} currency="INR" convert={false} />
              </span>
            </CardBody>
          </Card>

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
                  {categoryId === ''
                    ? 'Nothing recorded yet. Every expense paid from one of our accounts appears here.'
                    : 'Nothing filed under this category yet.'}
                </TableEmpty>
              ) : (
                items.map((e) => (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap">
                      {new Date(e.occurredAt).toLocaleDateString('en-IN')}
                      {e.note !== null && (
                        <div className="text-text-muted mt-0.5 max-w-xs text-xs">{e.note}</div>
                      )}
                    </Td>
                    <Td>
                      {e.categoryName === null ? (
                        // Not "—": an uncategorised cost is a real gap in
                        // the breakdown and should look like one.
                        <StatusBadge kind="pending" label="Uncategorised" />
                      ) : (
                        <span className="text-sm">{e.categoryName}</span>
                      )}
                    </Td>
                    <Td className="text-text-muted text-sm">{e.accountLabel}</Td>
                    <Td align="right">
                      <Money
                        amount={Math.abs(Number(e.signedAmount)).toFixed(2)}
                        currency={e.currency}
                        convert={false}
                        direction="debit"
                      />
                    </Td>
                    <Td className="text-text-faint font-mono text-xs break-all">
                      {e.reference ?? '—'}
                    </Td>
                    <Td className="text-text-muted text-xs">
                      {/* "System" rather than blank: a flow writing an
                          entry and nobody recording it are different
                          facts, and only one of them is a gap. */}
                      {e.recordedByName ?? 'System'}
                      <div className="text-text-faint">
                        {new Date(e.recordedAt).toLocaleDateString('en-IN')}
                      </div>
                    </Td>
                    <Td align="right">
                      {e.inboundFreightChargeId !== null ? (
                        <span className="text-status-delivered-fg text-xs">Attributed</span>
                      ) : LEG_CATEGORIES.has(e.categoryCode ?? '') && canWrite ? (
                        // Offered only on the categories where leaving
                        // it unattached is an actual double count. On
                        // rent or software there is no leg to attach to.
                        <Button variant="ghost" size="sm" onClick={() => onAttribute(e)}>
                          Attribute
                        </Button>
                      ) : (
                        <span className="text-text-faint">—</span>
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
    </Section>
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
  const amount = Math.abs(Number(entry.signedAmount)).toFixed(2);
  // A non-INR payment is priced in rupees by the server, at the rate in
  // force when it moved — the consignment's cost is the sum of those.
  const needsInr = entry.currency !== 'INR';

  async function save(): Promise<void> {
    setError(null);
    if (picked === null) {
      setError('Find the consignment this paid for');
      return;
    }
    try {
      await attribute.mutateAsync({
        freightChargeId: picked.id,
        bankEntryId: entry.id,
      });
      onClose();
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Attach this to a consignment"
      description={`${entry.currency} ${amount} from ${entry.accountLabel}. Attaching it moves the cost out of operating expenses and into that consignment's leg — where it is currently being counted twice.`}
    >
      <div className="space-y-4">
        {picked === null ? (
          <FormField
            label="Which consignment"
            required
            hint="Search by consignment number, receipt or seller."
          >
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="e.g. CN-2026-08"
              autoFocus
            />
            {term.trim().length >= 2 && (
              <div className="border-border mt-1 max-h-44 overflow-y-auto rounded-md border">
                {results.isLoading ? (
                  <p className="text-text-muted px-3 py-2 text-xs">Searching…</p>
                ) : (results.data ?? []).length === 0 ? (
                  <p className="text-text-muted px-3 py-2 text-xs">No freight bill matches that.</p>
                ) : (
                  (results.data ?? []).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="hover:bg-surface-raised block w-full px-3 py-2 text-left"
                      onClick={() => setPicked(f)}
                    >
                      <div className="text-sm">{f.consignmentNumber ?? 'Consignment'}</div>
                      <div className="text-text-muted text-xs">
                        {f.sellerCompanyName ?? ''} · billed {f.totalInr}
                        {f.ourCostInr === null ? ' · no cost recorded' : ` · cost ${f.ourCostInr}`}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </FormField>
        ) : (
          <FormField label="Attaching to">
            <div className="border-border bg-surface-raised flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {picked.consignmentNumber ?? 'Consignment'}
                </div>
                <div className="text-text-muted truncate text-xs">
                  {picked.sellerCompanyName ?? ''} · billed {picked.totalInr}
                </div>
              </div>
              <button
                type="button"
                className="text-text-muted hover:text-text shrink-0 text-xs underline underline-offset-2"
                onClick={() => setPicked(null)}
              >
                Change
              </button>
            </div>
          </FormField>
        )}

        {needsInr && (
          <p className="text-text-muted text-xs">
            Paid in {entry.currency}. It is priced in rupees at the rate recorded for the day it
            moved, and the consignment&apos;s cost becomes the sum of every payment against it.
          </p>
        )}
        {error !== null && <p className="text-danger text-sm">{error}</p>}
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={attribute.isPending} onClick={() => void save()}>
          {attribute.isPending ? 'Attaching…' : 'Attach'}
        </Button>
      </ModalFooter>
    </Modal>
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
    <Section
      title="Investments"
      subtitle="Capital placed where it can earn. It leaves the bank without being spent, so client-money coverage still reads correctly while it is out."
    >
      {investments.isLoading ? (
        <LoadingState />
      ) : investments.isError || investments.data === undefined ? (
        <ErrorState
          message={investments.error?.message ?? 'Could not read the investments.'}
          retry={() => void investments.refetch()}
        />
      ) : (
        <>
          <Card>
            <CardBody>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showClosed}
                  onChange={(e) => setShowClosed(e.target.checked)}
                />
                Show closed
              </label>
            </CardBody>
          </Card>

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
                  Nothing placed. A fixed deposit or a loan out is recorded here so it stops reading
                  as money that vanished.
                </TableEmpty>
              ) : (
                investments.data.map((i) => (
                  <Tr key={i.id}>
                    <Td>{i.label}</Td>
                    <Td className="text-text-muted">{i.counterparty}</Td>
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
                      <StatusBadge
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
                        <span className="text-text-faint">—</span>
                      )}
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        </>
      )}
    </Section>
  );
}
