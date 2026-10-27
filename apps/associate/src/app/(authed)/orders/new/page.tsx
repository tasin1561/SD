'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactElement } from 'react';
import {
  ArrowLeft,
  Banknote,
  OctagonX,
  PackageSearch,
  PackageX,
  PauseCircle,
  Plus,
  Send,
  Tag,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { Money, ProductThumb } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { VanDriveOffButton } from '@skydrop/ui/app/van-drive-off';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { ChoiceCards } from '@skydrop/ui/app/choice-cards';
import { NumberStepper } from '@skydrop/ui/app/number-stepper';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { richMessage, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { ordersPaused } from '@/lib/orders-paused';
import { itemLabel, itemThumb, useSellCatalogue } from '@/lib/catalogue-hooks';
import { useCreateOrder } from '@/lib/order-hooks';
import { BackLink, LinkButton, Notice, Section } from '../../_components/parts';
import { useUatField } from '@skydrop/ui/app/uat-fields';

interface Line {
  readonly key: number;
  readonly variantId: string;
  readonly quantity: string;
}

/**
 * ASSOC-1 capability 1 — place one order.
 *
 * ── THE PRICE IS FIXED AND THERE IS NO FIELD FOR IT ─────────────────
 * What this person sells each product for is their own `associate_prices`
 * row, set by hand by whoever runs the store. There is no markup rule and
 * no fallback: a product with no row is NAMED rather than priced at
 * something nobody chose, and cannot be added to an order. The price is
 * shown beside each line because somebody on the phone to a customer
 * needs to read it out — but it is text, not an input, and the server
 * refuses a retail that disagrees with the row anyway.
 *
 * ── WHAT IS NOT ON THIS PAGE ────────────────────────────────────────
 * No transfer price, no suggested retail, no retail range, no margin, no
 * "you earn". Those are what the STORE pays and what the store makes, and
 * an associate reading either knows the spread the store is making on
 * them. The prepaid note says the store's wallet covers the order and
 * names NO figure for the same reason — the goods total at the transfer
 * price IS the store's cost.
 *
 * ── PAUSED ──────────────────────────────────────────────────────────
 * When the store has switched this person's order creation off the form
 * is still fully readable and still submits: the pause can be turned on
 * between the page load and the send, so the only honest refusal is the
 * server's, and it arrives verbatim (FE-2). The notice at the top is so
 * nobody fills a whole order in to find out at the end.
 */
export default function NewOrderPage(): ReactElement {
  const t = useT();
  const me = useStoreIdentity();
  const router = useRouter();
  const catalogue = useSellCatalogue();
  const create = useCreateOrder();
  const paused = ordersPaused(me);

  const [lines, setLines] = useState<Line[]>([{ key: 1, variantId: '', quantity: '1' }]);
  const [nextKey, setNextKey] = useState(2);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+91');
  const [email, setEmail] = useState('');
  const [line1, setLine1] = useState('');
  const [landmark, setLandmark] = useState('');
  const [pin, setPin] = useState('');
  const [reference, setReference] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  // Hidden for UAT (owner, 2026-10-26), code intact. Not rendered means
  // it stays '' and the payload omits it, which is the same 0 the
  // server has always defaulted to. Reversible from UAT Settings.
  const showDeliveryFee = useUatField('orderDeliveryFee');
  const [codAmount, setCodAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [acknowledgeDuplicate, setAcknowledgeDuplicate] = useState(false);
  const [payment, setPayment] = useState<'COD' | 'PREPAID'>('COD');
  const [error, setError] = useState<string | null>(null);
  const [confirmPlace, setConfirmPlace] = useState(false);
  /** The van's BUSY state: from the send until the page leaves (or a refusal). */
  const [placing, setPlacing] = useState(false);
  /** Drives the van's error state only: set when the order did not go through. */
  const [placeFailed, setPlaceFailed] = useState(false);

  const items = useMemo(() => catalogue.data?.items ?? [], [catalogue.data]);
  const sellable = useMemo(() => items.filter((i) => i.retailPriceInr !== null), [items]);
  const unpriced = useMemo(() => items.filter((i) => i.retailPriceInr === null), [items]);
  const byId = useMemo(() => new Map(items.map((i) => [i.variantId, i])), [items]);
  // The SERVER's count, not a re-derivation: it is the one figure the
  // endpoint exists to report, and two ways of counting the same thing
  // eventually disagree.
  const unpricedCount = catalogue.data?.unpricedCount ?? unpriced.length;

  const retailTotal = lines.reduce((sum, l) => {
    const q = Number(l.quantity);
    const price = Number(byId.get(l.variantId)?.retailPriceInr ?? NaN);
    return Number.isFinite(q) && Number.isFinite(price) ? sum + q * price : sum;
  }, 0);
  const prepaid = payment === 'PREPAID';
  const collectDefault = retailTotal + (Number(deliveryFee) || 0);
  const chosen = lines.filter((l) => l.variantId !== '');

  function update(key: number, patch: Partial<Line>): void {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function submit(): Promise<void> {
    setError(null);
    setPlaceFailed(false);
    setPlacing(true);
    try {
      const created = await create.mutateAsync({
        ...(reference.trim() === '' ? {} : { sellerOrderRef: reference.trim() }),
        recipientName: name.trim(),
        recipientPhoneE164: phone.trim(),
        ...(email.trim() === '' ? {} : { recipientEmail: email.trim() }),
        recipientAddressLine1: line1.trim(),
        recipientAddressLine2: landmark.trim(),
        recipientPostalCode: pin.trim(),
        paymentMode: payment,
        // Both of these describe the COLLECTABLE, and a prepaid order has
        // none: the server refuses `codAmountInr` outright for PREPAID,
        // and the delivery charge is added to the collectable amount.
        ...(prepaid || deliveryFee.trim() === '' ? {} : { deliveryFeeInr: Number(deliveryFee) }),
        ...(prepaid || codAmount.trim() === '' ? {} : { codAmountInr: Number(codAmount) }),
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        ...(acknowledgeDuplicate ? { acknowledgeDuplicate: true } : {}),
        items: chosen.map((l) => ({
          variantId: l.variantId,
          quantity: Number(l.quantity),
          // Their own price, sent back exactly as the catalogue gave it.
          retailUnitPriceInr: Number(byId.get(l.variantId)?.retailPriceInr ?? 0),
        })),
      });
      // `placing` stays true: the van keeps driving while the page leaves.
      router.push(`/orders/${created.id}`);
    } catch (err) {
      setError(verdict(err, t));
      setPlaceFailed(true);
      setPlacing(false);
    }
  }

  const header = <PageHeader title={t('neworder.title')} subtitle={t('neworder.subtitle')} />;

  if (catalogue.isPending) {
    return (
      <div className="as-page">
        {header}
        <SkeletonRows rows={4} cols={3} label={t('catalogue.loading')} />
      </div>
    );
  }
  if (catalogue.isError) {
    return (
      <div className="as-page">
        {header}
        <ErrorState message={verdict(catalogue.error, t)} retry={() => void catalogue.refetch()} />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="as-page">
        {header}
        <EmptyState
          icon={<PackageSearch size={20} />}
          title={t('catalogue.empty.title')}
          description={t('neworder.empty.body')}
        />
      </div>
    );
  }

  return (
    <form
      className="as-page"
      onSubmit={(e) => {
        e.preventDefault();
        setConfirmPlace(true);
      }}
    >
      <BackLink href="/orders" icon={<ArrowLeft size={14} aria-hidden />}>
        {t('nav.myOrders')}
      </BackLink>
      {header}

      {/* The standing notice. The form below stays readable and still
          submits — the server's refusal is the honest one. */}
      {paused ? (
        <Notice
          tone="warn"
          icon={<PauseCircle size={16} />}
          title={t('account.paused.title')}
          role="status"
        >
          <span>{t('neworder.paused.body')}</span>
        </Notice>
      ) : null}

      <Section title={t('neworder.buying')} note={t('neworder.buyingNote')}>
        <div className="as-stack as-stack--tight">
          <ul className="as-lines">
            {lines.map((l) => {
              const item = byId.get(l.variantId);
              return (
                <li key={l.key} className="as-line">
                  <Select
                    label={t('neworder.product')}
                    aria-label={t('neworder.product')}
                    value={l.variantId}
                    onChange={(e) => update(l.key, { variantId: e.target.value })}
                  >
                    <option value="">{t('neworder.chooseProduct')}</option>
                    {sellable.map((i) => (
                      <option
                        key={i.variantId}
                        value={i.variantId}
                        disabled={i.availableQuantity === 0}
                      >
                        {t('neworder.optionLabel', { label: itemLabel(i), n: i.availableQuantity })}
                      </option>
                    ))}
                  </Select>
                  <NumberStepper
                    label={t('neworder.qty')}
                    aria-label={t('neworder.quantity')}
                    min={1}
                    value={l.quantity}
                    onChange={(e) => update(l.key, { quantity: e.target.value })}
                  />
                  <div className="as-line__remove">
                    {lines.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        icon={<Trash2 size={15} />}
                        aria-label={t('neworder.removeLine')}
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      />
                    ) : null}
                  </div>
                  {item !== undefined && item.retailPriceInr !== null ? (
                    // STATED, never a field: the price is your store's to
                    // set — said ONCE on the section heading rather than
                    // on every line. It was a fourth item on this row, and
                    // at 360px four 12px facts wrap into a block of grey
                    // with the one figure somebody reads down a phone
                    // buried inside it.
                    <p className="as-line__note">
                      <ProductThumb src={itemThumb(item)} size={32} alt="" />
                      <span className="as-line__price">
                        {richMessage(t('neworder.each'), {
                          price: <Money amount={item.retailPriceInr} convert={false} />,
                        })}
                      </span>
                      {item.availableQuantity === 0 ? (
                        <span className="as-flag" data-tone="bad">
                          <PackageX size={12} aria-hidden />
                          {t('neworder.noneLeft')}
                        </span>
                      ) : (
                        <span>{t('neworder.available', { n: item.availableQuantity })}</span>
                      )}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="as-row">
            <Button
              type="button"
              variant="ghost"
              icon={<Plus size={15} />}
              onClick={() => {
                setLines((ls) => [...ls, { key: nextKey, variantId: '', quantity: '1' }]);
                setNextKey((k) => k + 1);
              }}
            >
              {t('neworder.addAnother')}
            </Button>
          </div>

          {/* NAMED, with what to do about it — a product quietly missing
              from the picker is how somebody stops being able to sell it
              without ever learning why. */}
          {unpricedCount > 0 ? (
            <Notice tone="info" icon={<Tag size={16} />} title={t('catalogue.unpriced.title')}>
              <span>
                {t(unpricedCount === 1 ? 'neworder.unpriced.one' : 'neworder.unpriced.many', {
                  n: unpricedCount,
                  list: unpriced.map((i) => itemLabel(i)).join(', '),
                })}
              </span>
            </Notice>
          ) : null}
        </div>
      </Section>

      <Section title={t('neworder.where')}>
        <div className="as-grid-2">
          {/* The store's own order id, FIRST — owner, 2026-10-26. It is
              the number they already have in their own system and the
              one they quote when they ring about this parcel, so it is
              the first thing they copy across, not the last. */}
          <TextField
            label={t('neworder.reference')}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <TextField
            label={t('neworder.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <TextField
            label={t('neworder.phone')}
            hint={t('neworder.phoneHint')}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            required
          />
          <TextField
            label={t('neworder.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label={t('neworder.pin')}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            inputMode="numeric"
            required
          />
          <TextField
            label={t('neworder.address')}
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            required
          />
          <TextField
            label={t('neworder.landmark')}
            hint={t('neworder.landmarkHint')}
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            required
          />
        </div>
      </Section>

      <Section title={t('neworder.paid')}>
        <div className="as-stack as-stack--tight">
          <ChoiceCards
            label={t('neworder.paidQuestion')}
            name="associate-order-payment"
            columns={2}
            value={payment}
            onChange={(v) => setPayment(v === 'PREPAID' ? 'PREPAID' : 'COD')}
            options={[
              {
                value: 'COD',
                icon: <Banknote size={16} />,
                title: t('neworder.cod.title'),
                description: t('neworder.cod.desc'),
              },
              {
                value: 'PREPAID',
                icon: <Wallet size={16} />,
                title: t('neworder.prepaid.title'),
                description: t('neworder.prepaid.desc'),
              },
            ]}
          />

          <div className="as-grid-2">
            {prepaid ? null : (
              <>
                {showDeliveryFee ? (
                  <TextField
                    label={t('neworder.deliveryFee')}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(e.target.value)}
                  />
                ) : null}
                <TextField
                  label={t('neworder.cash')}
                  hint={richMessage(t('neworder.cashHint'), {
                    amount: <Money amount={collectDefault} convert={false} />,
                  })}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={codAmount}
                  onChange={(e) => setCodAmount(e.target.value)}
                />
              </>
            )}
          </div>
          <TextArea
            label={t('neworder.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            showCount
          />
          {prepaid ? (
            // No figure, deliberately: what the store's wallet pays is the
            // store's cost, which is not this person's to know.
            <Notice tone="info" icon={<Wallet size={16} />}>
              <span>{t('neworder.prepaidNote')}</span>
            </Notice>
          ) : (
            <Notice tone="info" icon={<Banknote size={16} />}>
              <span>{t('neworder.codNote')}</span>
            </Notice>
          )}
        </div>
      </Section>

      {error !== null ? (
        <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
          <p className="as-error">{error}</p>
          {error.includes('DUPLICATE_ORDER_SUSPECTED') ? (
            <Checkbox
              label={t('neworder.duplicate')}
              checked={acknowledgeDuplicate}
              onChange={(e) => setAcknowledgeDuplicate(e.target.checked)}
            />
          ) : null}
        </Notice>
      ) : null}

      <div className="as-bar">
        <p className="as-bar__summary">
          {chosen.length === 0
            ? t('neworder.summary.none')
            : t('neworder.summary', {
                products: t(
                  chosen.length === 1 ? 'neworder.products.one' : 'neworder.products.other',
                  {
                    n: chosen.length,
                  },
                ),
                mode: prepaid ? t('neworder.mode.prepaid') : t('neworder.mode.cod'),
              })}
        </p>
        <div className="as-bar__actions">
          <LinkButton href="/orders" variant="ghost">
            {t('neworder.cancel')}
          </LinkButton>
          <VanDriveOffButton
            type="submit"
            mode="while-busy"
            variant="primary"
            className="as-nowrap"
            icon={<Send size={15} />}
            label={t('neworder.place')}
            busyLabel={t('neworder.placing')}
            errorLabel={t('neworder.notPlaced')}
            state={placing ? 'busy' : placeFailed ? 'error' : 'idle'}
            onAction={async () => {
              setConfirmPlace(true);
            }}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmPlace}
        onOpenChange={setConfirmPlace}
        title={t('neworder.confirm.title')}
        entity={`${name.trim()} · ${phone.trim()}`}
        amount={
          prepaid ? (
            t('neworder.confirm.alreadyPaid')
          ) : (
            <>
              {richMessage(t('neworder.confirm.toCollect'), {
                amount:
                  codAmount.trim() === '' ? (
                    <Money amount={collectDefault} convert={false} />
                  ) : (
                    <Money amount={codAmount.trim()} convert={false} />
                  ),
              })}
            </>
          )
        }
        consequence={t('neworder.confirm.consequence', {
          products: t(
            chosen.length === 1
              ? 'neworder.confirm.products.one'
              : 'neworder.confirm.products.other',
            { n: chosen.length },
          ),
          mode: prepaid ? t('neworder.confirm.mode.prepaid') : t('neworder.confirm.mode.cod'),
        })}
        confirmLabel={t('neworder.place')}
        cancelLabel={t('neworder.confirm.notYet')}
        // Closes at once: the van on the page carries the busy state while
        // the order is created (submit() never throws — it reports on the page).
        onConfirm={() => {
          void submit();
        }}
      />
    </form>
  );
}
