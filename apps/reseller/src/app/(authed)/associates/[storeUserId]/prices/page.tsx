'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Copy,
  PackageOpen,
  SearchX,
  TriangleAlert,
} from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button, buttonClassName } from '@skydrop/ui/app/button';
import { Table, TableToolbar, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useAssociatePrices,
  useAssociates,
  useCopyAssociatePrices,
  useSetAssociatePrice,
  type AssociateCopyResult,
  type AssociatePriceRow,
} from '@/lib/associate-hooks';
import { RdCallout, phaseOf } from '../../../settings/_components/rd-parts';
import { AsSection } from '../../_components/associate-parts';
import '../../_components/associates.css';

/**
 * ASSOC-1 — what ONE associate sells each product at.
 *
 * Set by hand, per person: A and B may sell the same thing at different
 * prices, there is no markup rule and there is no fallback — a product
 * with no row here cannot be sold by this person at all, and their order
 * is refused by name rather than priced at something nobody chose.
 *
 * The seller's allowed range is a COLUMN, beside the field, because a
 * price outside it is refused: saying the range before the refusal is
 * the difference between a form somebody fills in once and one they
 * guess at. The refusal itself is never predicted here (FE-2) — the
 * server owns `ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE` and its words are
 * shown exactly where the figure that earned them is.
 */
export default function AssociatePricesPage(): ReactElement {
  const params = useParams<{ storeUserId: string }>();
  const storeUserId = params.storeUserId ?? '';
  const associates = useAssociates();
  const prices = useAssociatePrices(storeUserId);
  const [search, setSearch] = useState('');
  const [copying, setCopying] = useState(false);

  // Only for the "copy from" picker. The person's OWN name comes from
  // their prices payload, so this page still reads correctly while the
  // roster is loading or has failed.
  const others = (associates.data?.associates ?? []).filter((a) => a.storeUserId !== storeUserId);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = prices.data?.rows ?? [];
    return q === ''
      ? all
      : all.filter(
          (r) =>
            r.productName.toLowerCase().includes(q) ||
            r.skuCode.toLowerCase().includes(q) ||
            (r.variantLabel ?? '').toLowerCase().includes(q),
        );
  }, [prices.data, search]);

  const name = prices.data?.fullName ?? 'this associate';
  const priced = (prices.data?.rows ?? []).filter((r) => r.retailPriceInr !== null).length;
  const outOfRange = (prices.data?.rows ?? []).filter((r) => r.outOfRange).length;

  const header = (
    <PageHeader
      title={prices.data === undefined ? 'Their prices' : `${prices.data.fullName}’s prices`}
      subtitle="What this person sells each product at. Until a product has a price here, they cannot sell it."
      action={
        <div className="as-row-actions">
          <Link href="/associates" className={buttonClassName('secondary', 'md')}>
            <span className="sk-btn__fx" aria-hidden />
            <span className="sk-btn__icon" aria-hidden>
              <ArrowLeft size={15} />
            </span>
            <span className="sk-btn__label">All associates</span>
          </Link>
          {others.length > 0 ? (
            <Button
              variant="secondary"
              size="md"
              icon={<Copy size={15} />}
              onClick={() => setCopying(true)}
            >
              Copy prices from…
            </Button>
          ) : null}
        </div>
      }
    />
  );

  if (prices.isPending) {
    return (
      <div className="as-page">
        {header}
        <SkeletonRows rows={6} cols={4} label="Loading their prices" />
      </div>
    );
  }
  if (prices.isError) {
    return (
      <div className="as-page">
        {header}
        <ErrorState message={serverVerdict(prices.error)} retry={() => void prices.refetch()} />
      </div>
    );
  }

  const none = prices.data.rows.length === 0;

  return (
    <div className="as-page">
      {header}
      <AsSection>
        <SectionHeading
          title="Products"
          note={
            none
              ? undefined
              : `${priced} of ${prices.data.rows.length} priced${outOfRange > 0 ? ` · ${outOfRange} now outside the seller’s range` : ''}`
          }
        />
        <TableToolbar
          search={{
            value: search,
            onChange: setSearch,
            label: 'Search by name or SKU',
            placeholder: 'Search name or SKU',
          }}
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={none ? <PackageOpen size={22} /> : <SearchX size={22} />}
            title={none ? 'Nothing to price yet' : 'Nothing matches that search'}
            description={
              none
                ? 'Your seller has not turned any products on for this store yet, so there is nothing for an associate to sell.'
                : undefined
            }
            action={
              none ? (
                <Link href="/catalogue" className={buttonClassName('secondary', 'md')}>
                  <span className="sk-btn__fx" aria-hidden />
                  <span className="sk-btn__label">Open your catalogue</span>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Table caption="Prices for this associate">
            <THead>
              <Tr>
                <Th>Product</Th>
                <Th>Sell between</Th>
                <Th>Suggested</Th>
                <Th>They sell at</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <PriceRow key={row.variantId} row={row} storeUserId={storeUserId} />
              ))}
            </TBody>
          </Table>
        )}
      </AsSection>

      {others.length > 0 ? (
        <CopyPricesDialog
          open={copying}
          onOpenChange={setCopying}
          storeUserId={storeUserId}
          toName={name}
          alreadyPriced={priced}
          others={others}
        />
      ) : null}
    </div>
  );
}

/** The seller's range, read as words when a side has no bound. */
function RangeCell({
  min,
  max,
}: {
  readonly min: string | null;
  readonly max: string | null;
}): ReactElement {
  if (min === null && max === null) return <>Any price</>;
  return (
    <span className="as-nowrap">
      {min === null ? 'up to ' : <Money amount={min} convert={false} />}
      {min !== null && max !== null ? ' – ' : null}
      {max === null ? ' or more' : <Money amount={max} convert={false} />}
    </span>
  );
}

/** "between ₹400 and ₹600" / "at least ₹400" / "at most ₹600". */
function rangeWords(min: string | null, max: string | null): string {
  if (min !== null && max !== null) return `between ₹${min} and ₹${max}`;
  if (min !== null) return `at or above ₹${min}`;
  if (max !== null) return `at or below ₹${max}`;
  return 'at any price';
}

/**
 * One product's price, edited where it is read.
 *
 * The draft is reset whenever the SERVER's value changes — after a save
 * of our own, or after somebody else's — by comparing against the last
 * value we were given, so a figure the server normalised (250 → 250.00)
 * does not sit on screen reading as unsaved for ever.
 */
function PriceRow({
  row,
  storeUserId,
}: {
  readonly row: AssociatePriceRow;
  readonly storeUserId: string;
}): ReactElement {
  const toast = useToast();
  const save = useSetAssociatePrice(storeUserId);
  const server = row.retailPriceInr ?? '';
  const [draft, setDraft] = useState(server);
  const [lastServer, setLastServer] = useState(server);
  const [error, setError] = useState<string | null>(null);
  if (server !== lastServer) {
    setLastServer(server);
    setDraft(server);
    setError(null);
  }

  const trimmed = draft.trim();
  // An empty field is not a price, and "clear this price" is not
  // something the API takes — so the button is simply unavailable, which
  // is a layout decision rather than a rule. Every real rule, the
  // seller's range included, is the server's (FE-2).
  const dirty = trimmed !== server && trimmed !== '';

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await save.mutateAsync({ variantId: row.variantId, retailPriceInr: trimmed });
      toast.success(`${row.productName} saved.`);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Tr>
      <Td>
        <div className="as-product">
          <span className="as-product__title">{row.productName}</span>
          <span className="as-faint">
            <span className="sk-ident">{row.skuCode}</span>
            {row.variantLabel !== null && row.variantLabel !== '' ? ` · ${row.variantLabel}` : ''}
          </span>
        </div>
      </Td>
      <Td>
        <RangeCell min={row.minRetailInr} max={row.maxRetailInr} />
      </Td>
      <Td>
        {row.suggestedRetailInr === null ? (
          '—'
        ) : (
          <Money amount={row.suggestedRetailInr} convert={false} />
        )}
      </Td>
      <Td>
        <form className="as-price" onSubmit={submit}>
          <div className="as-price__row">
            <TextField
              className="as-price__field"
              id={`price-${row.variantId}`}
              aria-label={`What they sell ${row.productName} at, in rupees`}
              inputMode="decimal"
              inputClassName="sk-figure"
              lead="₹"
              placeholder="0.00"
              disabled={save.isPending}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <AsyncButton
              type="submit"
              variant={dirty ? 'primary' : 'secondary'}
              size="sm"
              icon={<Check size={14} />}
              labels={{ idle: 'Save', busy: 'Saving…', error: 'Not saved' }}
              state={phaseOf(save.isPending, error)}
              disabled={!dirty || save.isPending}
            />
          </div>
          {row.retailPriceInr === null ? (
            <p className="as-price__note">
              <TriangleAlert size={12} aria-hidden />
              No price yet — they cannot sell this.
            </p>
          ) : null}
          {row.outOfRange ? (
            <p className="as-price__note">
              <TriangleAlert size={12} aria-hidden />
              <span>
                Outside what your seller now allows. Orders at this price are refused — set one{' '}
                {rangeWords(row.minRetailInr, row.maxRetailInr)}.
              </span>
            </p>
          ) : null}
          {error !== null ? (
            <p className="as-price__verdict" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </Td>
    </Tr>
  );
}

/** One named list in the copy report. Nothing is shown as a bare count. */
function ReportList({
  title,
  items,
}: {
  readonly title: string;
  readonly items: ReadonlyArray<{ readonly variantId: string; readonly text: ReactNode }>;
}): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <>
      <p className="as-muted">
        {title} ({items.length})
      </p>
      <ul className="as-report__list">
        {items.map((i) => (
          <li key={i.variantId}>{i.text}</li>
        ))}
      </ul>
    </>
  );
}

/**
 * Copy every price from another associate onto this one.
 *
 * The dialog states what it will REPLACE before it runs, and the
 * server's report is then shown IN FULL — what was created, what was
 * overwritten and the figure each replaced, what was already the same,
 * and every product it SKIPPED with the reason in the server's own
 * words. A copy that silently dropped a third of its rows and said
 * "done" is how somebody finds out at the order instead.
 */
function CopyPricesDialog({
  open,
  onOpenChange,
  storeUserId,
  toName,
  alreadyPriced,
  others,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly storeUserId: string;
  readonly toName: string;
  readonly alreadyPriced: number;
  readonly others: ReadonlyArray<{ readonly storeUserId: string; readonly fullName: string }>;
}): ReactElement {
  const copy = useCopyAssociatePrices(storeUserId);
  const [from, setFrom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssociateCopyResult | null>(null);

  function close(): void {
    onOpenChange(false);
    setResult(null);
    setError(null);
    setFrom('');
  }

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      setResult(await copy.mutateAsync({ fromStoreUserId: from }));
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
      icon={<Copy size={18} />}
      title={`Copy prices to ${toName}`}
      size="lg"
      description={
        result === null
          ? 'Every price the person you choose has becomes this person’s price too.'
          : undefined
      }
    >
      {result !== null ? (
        <div className="as-form">
          <div className="as-report">
            <p>
              Copied from <strong className="as-strong">{result.from.fullName}</strong> to{' '}
              <strong className="as-strong">{result.to.fullName}</strong>: {result.created.length}{' '}
              new, {result.overwritten.length} replaced, {result.unchanged.length} already the same,{' '}
              {result.skipped.length} skipped.
            </p>
            <ReportList
              title="Newly priced"
              items={result.created.map((c) => ({
                variantId: c.variantId,
                text: (
                  <>
                    <span className="sk-ident">{c.skuCode}</span> —{' '}
                    <Money amount={c.retailPriceInr} convert={false} />
                  </>
                ),
              }))}
            />
            <ReportList
              title="Replaced"
              items={result.overwritten.map((o) => ({
                variantId: o.variantId,
                text: (
                  <>
                    <span className="sk-ident">{o.skuCode}</span> —{' '}
                    <Money amount={o.fromInr} convert={false} /> →{' '}
                    <Money amount={o.toInr} convert={false} />
                  </>
                ),
              }))}
            />
            <ReportList
              title="Already the same"
              items={result.unchanged.map((u) => ({
                variantId: u.variantId,
                text: (
                  <>
                    <span className="sk-ident">{u.skuCode}</span> —{' '}
                    <Money amount={u.retailPriceInr} convert={false} />
                  </>
                ),
              }))}
            />
            <ReportList
              title="Skipped — still no price from this copy"
              items={result.skipped.map((s) => ({
                variantId: s.variantId,
                text: (
                  <>
                    <span className="sk-ident">{s.skuCode}</span> — [{s.code}] {s.message}
                  </>
                ),
              }))}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="primary" size="md" onClick={close}>
              Done
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <form onSubmit={submit} className="as-form">
          <Select
            id="copy-from"
            label="Copy from"
            required
            value={from}
            disabled={copy.isPending}
            onChange={(e) => setFrom(e.target.value)}
          >
            <option value="">Choose an associate</option>
            {others.map((o) => (
              <option key={o.storeUserId} value={o.storeUserId}>
                {o.fullName}
              </option>
            ))}
          </Select>
          <p className="as-muted">
            {alreadyPriced === 0
              ? `${toName} has no prices yet, so nothing of theirs is replaced.`
              : `${toName} already has ${alreadyPriced} price${alreadyPriced === 1 ? '' : 's'}. Copying REPLACES every one the other person also has a price for, and the old figures are not kept — the reply names each one so you can put a figure back by hand.`}
          </p>
          {error !== null ? (
            <RdCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
              <p>{error}</p>
            </RdCallout>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" size="md" onClick={close}>
              Cancel
            </Button>
            <AsyncButton
              type="submit"
              variant="primary"
              size="md"
              icon={<Copy size={15} />}
              labels={{ idle: 'Copy prices', busy: 'Copying…', error: 'Not copied' }}
              state={phaseOf(copy.isPending, error)}
              disabled={copy.isPending || from === ''}
            />
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}
