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
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { richMessage, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
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
  const t = useT();
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

  const name = prices.data?.fullName ?? t('assocp.nameFallback');
  const priced = (prices.data?.rows ?? []).filter((r) => r.retailPriceInr !== null).length;
  const outOfRange = (prices.data?.rows ?? []).filter((r) => r.outOfRange).length;

  const header = (
    <PageHeader
      title={
        prices.data === undefined
          ? t('assocp.titleUnknown')
          : t('assocp.title', { name: prices.data.fullName })
      }
      subtitle={t('assocp.subtitle')}
      action={
        <div className="as-row-actions">
          <Link href="/associates" className={buttonClassName('secondary', 'md')}>
            <span className="sk-btn__fx" aria-hidden />
            <span className="sk-btn__icon" aria-hidden>
              <ArrowLeft size={15} />
            </span>
            <span className="sk-btn__label">{t('assocp.all')}</span>
          </Link>
          {others.length > 0 ? (
            <Button
              variant="secondary"
              size="md"
              icon={<Copy size={15} />}
              onClick={() => setCopying(true)}
            >
              {t('assocp.copyFrom')}
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
        <SkeletonRows rows={6} cols={4} label={t('assocp.loading')} />
      </div>
    );
  }
  if (prices.isError) {
    return (
      <div className="as-page">
        {header}
        <ErrorState message={verdict(prices.error, t)} retry={() => void prices.refetch()} />
      </div>
    );
  }

  const none = prices.data.rows.length === 0;

  return (
    <div className="as-page">
      {header}
      <AsSection>
        <SectionHeading
          title={t('assocp.section')}
          note={
            none
              ? undefined
              : outOfRange > 0
                ? t('assocp.noteOut', { priced, total: prices.data.rows.length, out: outOfRange })
                : t('assocp.note', { priced, total: prices.data.rows.length })
          }
        />
        <TableToolbar
          search={{
            value: search,
            onChange: setSearch,
            label: t('assocp.search.label'),
            placeholder: t('assocp.search.placeholder'),
          }}
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={none ? <PackageOpen size={22} /> : <SearchX size={22} />}
            title={none ? t('assocp.empty.none') : t('assocp.empty.noMatch')}
            description={none ? t('assocp.empty.body') : undefined}
            action={
              none ? (
                <Link href="/catalogue" className={buttonClassName('secondary', 'md')}>
                  <span className="sk-btn__fx" aria-hidden />
                  <span className="sk-btn__label">{t('assocp.openCatalogue')}</span>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Table caption={t('assocp.caption')}>
            <THead>
              <Tr>
                <Th>{t('assocp.col.product')}</Th>
                <Th>{t('assocp.col.between')}</Th>
                <Th>{t('assocp.col.suggested')}</Th>
                <Th>{t('assocp.col.theySell')}</Th>
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
  const t = useT();
  if (min === null && max === null) return <>{t('assocp.range.any')}</>;
  const m = (v: string): ReactElement => <Money amount={v} convert={false} />;
  return (
    <span className="as-nowrap">
      {min !== null && max !== null
        ? richMessage(t('assocp.range.between'), { min: m(min), max: m(max) })
        : min === null
          ? richMessage(t('assocp.range.upTo'), { max: m(max ?? '0') })
          : richMessage(t('assocp.range.atLeast'), { min: m(min) })}
    </span>
  );
}

/** "between ₹400 and ₹600" / "at least ₹400" / "at most ₹600". */
function rangeWords(min: string | null, max: string | null, t: Translate<MessageKey>): string {
  if (min !== null && max !== null) return t('assocp.words.between', { min, max });
  if (min !== null) return t('assocp.words.atLeast', { min });
  if (max !== null) return t('assocp.words.atMost', { max });
  return t('assocp.words.any');
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
  const t = useT();
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
      toast.success(t('assocp.saved', { product: row.productName }));
    } catch (err) {
      setError(verdict(err, t));
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
              aria-label={t('assocp.price.aria', { product: row.productName })}
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
              labels={{
                idle: t('assocp.price.save'),
                busy: t('assocp.price.saving'),
                error: t('assocp.price.notSaved'),
              }}
              state={phaseOf(save.isPending, error)}
              disabled={!dirty || save.isPending}
            />
          </div>
          {row.retailPriceInr === null ? (
            <p className="as-price__note">
              <TriangleAlert size={12} aria-hidden />
              {t('assocp.price.none')}
            </p>
          ) : null}
          {row.outOfRange ? (
            <p className="as-price__note">
              <TriangleAlert size={12} aria-hidden />
              <span>
                {t('assocp.price.outside', {
                  range: rangeWords(row.minRetailInr, row.maxRetailInr, t),
                })}
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
  const t = useT();
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
      setError(verdict(err, t));
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
      title={t('assocp.copy.title', { name: toName })}
      size="lg"
      description={result === null ? t('assocp.copy.desc') : undefined}
    >
      {result !== null ? (
        <div className="as-form">
          <div className="as-report">
            <p>
              {richMessage(
                t('assocp.copy.report', {
                  created: result.created.length,
                  overwritten: result.overwritten.length,
                  unchanged: result.unchanged.length,
                  skipped: result.skipped.length,
                }),
                {
                  from: <strong className="as-strong">{result.from.fullName}</strong>,
                  to: <strong className="as-strong">{result.to.fullName}</strong>,
                },
              )}
            </p>
            <ReportList
              title={t('assocp.copy.created')}
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
              title={t('assocp.copy.replaced')}
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
              title={t('assocp.copy.same')}
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
              title={t('assocp.copy.skipped')}
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
              {t('assocp.copy.done')}
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <form onSubmit={submit} className="as-form">
          <Select
            id="copy-from"
            label={t('assocp.copy.from')}
            required
            value={from}
            disabled={copy.isPending}
            onChange={(e) => setFrom(e.target.value)}
          >
            <option value="">{t('assocp.copy.choose')}</option>
            {others.map((o) => (
              <option key={o.storeUserId} value={o.storeUserId}>
                {o.fullName}
              </option>
            ))}
          </Select>
          <p className="as-muted">
            {alreadyPriced === 0
              ? t('assocp.copy.noPrices', { name: toName })
              : t(
                  alreadyPriced === 1 ? 'assocp.copy.hasPrices.one' : 'assocp.copy.hasPrices.other',
                  {
                    name: toName,
                    n: alreadyPriced,
                  },
                )}
          </p>
          {error !== null ? (
            <RdCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
              <p>{error}</p>
            </RdCallout>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" size="md" onClick={close}>
              {t('assocp.copy.cancel')}
            </Button>
            <AsyncButton
              type="submit"
              variant="primary"
              size="md"
              icon={<Copy size={15} />}
              labels={{
                idle: t('assocp.copy.submit'),
                busy: t('assocp.copy.copying'),
                error: t('assocp.copy.notCopied'),
              }}
              state={phaseOf(copy.isPending, error)}
              disabled={copy.isPending || from === ''}
            />
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}
