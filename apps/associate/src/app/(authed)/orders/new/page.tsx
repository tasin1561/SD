'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactElement } from 'react';
import {
  ArrowLeft,
  Banknote,
  OctagonX,
  PackageSearch,
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
import { serverVerdict } from '@/lib/server-verdict';
import { ordersPaused } from '@/lib/orders-paused';
import { itemLabel, itemThumb, useSellCatalogue } from '@/lib/catalogue-hooks';
import { useCreateOrder } from '@/lib/order-hooks';
import { BackLink, LinkButton, Notice, Section } from '../../_components/parts';

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
      setError(serverVerdict(err));
      setPlaceFailed(true);
      setPlacing(false);
    }
  }

  const header = (
    <PageHeader
      title="New order"
      subtitle="Pick what your customer is buying and say where it is going. Your prices are set by your store."
    />
  );

  if (catalogue.isPending) {
    return (
      <div className="as-page">
        {header}
        <SkeletonRows rows={4} cols={3} label="Loading what you can sell" />
      </div>
    );
  }
  if (catalogue.isError) {
    return (
      <div className="as-page">
        {header}
        <ErrorState
          message={serverVerdict(catalogue.error)}
          retry={() => void catalogue.refetch()}
        />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="as-page">
        {header}
        <EmptyState
          icon={<PackageSearch size={20} />}
          title="Nothing to sell yet"
          description="Your store has not given you any products to sell. Ask whoever runs it to add some, then come back."
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
        My orders
      </BackLink>
      {header}

      {/* The standing notice. The form below stays readable and still
          submits — the server's refusal is the honest one. */}
      {paused ? (
        <Notice
          tone="warn"
          icon={<PauseCircle size={16} />}
          title="Your store has paused new orders from you"
          role="status"
        >
          <span>
            You can still read, track and follow up everything you have already placed. Ask whoever
            runs your store to switch it back on.
          </span>
        </Notice>
      ) : null}

      <Section title="What they are buying">
        <div className="as-stack as-stack--tight">
          <ul className="as-lines">
            {lines.map((l) => {
              const item = byId.get(l.variantId);
              return (
                <li key={l.key} className="as-line">
                  <Select
                    label="Product"
                    aria-label="Product"
                    value={l.variantId}
                    onChange={(e) => update(l.key, { variantId: e.target.value })}
                  >
                    <option value="">Choose a product</option>
                    {sellable.map((i) => (
                      <option
                        key={i.variantId}
                        value={i.variantId}
                        disabled={i.availableQuantity === 0}
                      >
                        {itemLabel(i)} — {i.availableQuantity} available
                      </option>
                    ))}
                  </Select>
                  <NumberStepper
                    label="Qty"
                    aria-label="Quantity"
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
                        aria-label="Remove this product"
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      />
                    ) : null}
                  </div>
                  {item !== undefined && item.retailPriceInr !== null ? (
                    // STATED, never a field: the price is your store's to set.
                    <p className="as-line__note">
                      <ProductThumb src={itemThumb(item)} size={32} alt="" />
                      <span className="as-line__price">
                        <Money amount={item.retailPriceInr} convert={false} /> each
                      </span>
                      <span>{item.availableQuantity} available</span>
                      <span>Your store sets this price</span>
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
              Add another product
            </Button>
          </div>

          {/* NAMED, with what to do about it — a product quietly missing
              from the picker is how somebody stops being able to sell it
              without ever learning why. */}
          {unpricedCount > 0 ? (
            <Notice tone="info" icon={<Tag size={16} />} title="Waiting for a price">
              <span>
                {unpricedCount === 1 ? 'One product is' : `${unpricedCount} products are`} missing
                from the list above because nobody has set your price for{' '}
                {unpricedCount === 1 ? 'it' : 'them'}:{' '}
                {unpriced.map((i) => itemLabel(i)).join(', ')}. Ask whoever runs your store to set
                one.
              </span>
            </Notice>
          ) : null}
        </div>
      </Section>

      <Section title="Where it is going">
        <div className="as-grid-2">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <TextField
            label="Phone"
            hint="With the country code, e.g. +919876543210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            required
          />
          <TextField
            label="Email (optional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label="PIN code"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            inputMode="numeric"
            required
          />
          <TextField
            label="Address"
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            required
          />
          <TextField
            label="Landmark"
            hint="What a driver looks for to find the door"
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            required
          />
        </div>
      </Section>

      <Section title="How it is paid for">
        <div className="as-stack as-stack--tight">
          <ChoiceCards
            label="How is this one paid for?"
            name="associate-order-payment"
            columns={2}
            value={payment}
            onChange={(v) => setPayment(v === 'PREPAID' ? 'PREPAID' : 'COD')}
            options={[
              {
                value: 'COD',
                icon: <Banknote size={16} />,
                title: 'Cash on delivery',
                description: 'The courier collects from your customer on the doorstep.',
              },
              {
                value: 'PREPAID',
                icon: <Wallet size={16} />,
                title: 'Prepaid',
                description: 'Your customer has already paid. Nothing is collected on delivery.',
              },
            ]}
          />

          <div className="as-grid-2">
            {prepaid ? null : (
              <>
                <TextField
                  label="Delivery charge to the customer (₹, optional)"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={deliveryFee}
                  onChange={(e) => setDeliveryFee(e.target.value)}
                />
                <TextField
                  label="Cash to collect (₹)"
                  hint={
                    <>
                      Leave blank to collect <Money amount={collectDefault} convert={false} />
                    </>
                  }
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={codAmount}
                  onChange={(e) => setCodAmount(e.target.value)}
                />
              </>
            )}
            <TextField
              label="Your reference (optional)"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          <TextArea
            label="Notes for the call centre (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            showCount
          />
          {prepaid ? (
            // No figure, deliberately: what the store's wallet pays is the
            // store's cost, which is not this person's to know.
            <Notice tone="info" icon={<Wallet size={16} />}>
              <span>
                Nothing is collected on delivery. Your store's wallet covers this order when it is
                confirmed; if it cannot, the order is refused and nothing is placed.
              </span>
            </Notice>
          ) : (
            <Notice tone="info" icon={<Banknote size={16} />}>
              <span>
                Skydrop's call centre rings every customer to confirm the order before it is packed.
              </span>
            </Notice>
          )}
        </div>
      </Section>

      {error !== null ? (
        <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
          <p className="as-error">{error}</p>
          {error.includes('DUPLICATE_ORDER_SUSPECTED') ? (
            <Checkbox
              label="This is a separate order — place it anyway"
              checked={acknowledgeDuplicate}
              onChange={(e) => setAcknowledgeDuplicate(e.target.checked)}
            />
          ) : null}
        </Notice>
      ) : null}

      <div className="as-bar">
        <p className="as-bar__summary">
          {chosen.length === 0
            ? 'No products chosen yet'
            : `${chosen.length} ${chosen.length === 1 ? 'product' : 'products'} · ${
                prepaid ? 'prepaid' : 'cash on delivery'
              }`}
        </p>
        <div className="as-bar__actions">
          <LinkButton href="/orders" variant="ghost">
            Cancel
          </LinkButton>
          <VanDriveOffButton
            type="submit"
            mode="while-busy"
            variant="primary"
            className="as-nowrap"
            icon={<Send size={15} />}
            label="Place order"
            busyLabel="Placing…"
            errorLabel="Not placed"
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
        title="Place this order?"
        entity={`${name.trim()} · ${phone.trim()}`}
        amount={
          prepaid ? (
            'Already paid'
          ) : (
            <>
              {codAmount.trim() === '' ? (
                <Money amount={collectDefault} convert={false} />
              ) : (
                <Money amount={codAmount.trim()} convert={false} />
              )}{' '}
              to collect
            </>
          )
        }
        consequence={`It is placed for ${
          chosen.length === 1 ? 'one product' : `${chosen.length} products`
        }, ${
          prepaid ? 'already paid for' : 'cash on delivery'
        }, and goes to Skydrop's call centre, who ring the customer to confirm it before it is packed.`}
        confirmLabel="Place order"
        cancelLabel="Not yet"
        // Closes at once: the van on the page carries the busy state while
        // the order is created (submit() never throws — it reports on the page).
        onConfirm={() => {
          void submit();
        }}
      />
    </form>
  );
}
