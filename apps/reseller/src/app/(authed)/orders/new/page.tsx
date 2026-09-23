'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  ArrowLeft,
  Banknote,
  BookOpen,
  OctagonX,
  PackageSearch,
  Plus,
  Send,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { Money } from '@skydrop/ui/components';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Stepper } from '@skydrop/ui/app/stepper';
import { Button } from '@skydrop/ui/app/button';
import { VanDriveOffButton } from '@skydrop/ui/app/van-drive-off';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { NumberStepper } from '@skydrop/ui/app/number-stepper';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { useStoreCatalogue, type StoreCatalogueItem } from '@/lib/catalogue-hooks';
import { useCreateStoreOrder } from '@/lib/order-hooks';
import { BackLink, LinkButton, Notice, RoSection } from '../_components/orders-parts';

interface Line {
  readonly key: number;
  readonly variantId: string;
  readonly quantity: string;
  readonly retail: string;
}

function rangeWords(i: StoreCatalogueItem): ReactNode {
  const m = (v: string): ReactNode => <Money amount={v} convert={false} />;
  if (i.minRetailInr === null && i.maxRetailInr === null) return 'any price';
  if (i.minRetailInr !== null && i.maxRetailInr !== null)
    return (
      <>
        between {m(i.minRetailInr)} and {m(i.maxRetailInr)}
      </>
    );
  return i.minRetailInr !== null ? (
    <>{m(i.minRetailInr)} or more</>
  ) : (
    <>up to {m(i.maxRetailInr ?? '0')}</>
  );
}

/**
 * RS-5 — place an order from this store's catalogue. The retail range and
 * the number available are the catalogue's (the same figures the
 * catalogue page shows); the server checks every one of them again, and
 * this form shows whatever it says, verbatim (FE-2). Orders are cash on
 * delivery for now — prepaid waits for the store wallet.
 *
 * ── THE PLACE BUTTON (apps restyle, owner 2026-09-24) ────────────────
 * "Place order" asks once, restating who it goes to and what is to be
 * collected, then the button IS the van while the order is created: it
 * turns into the van the moment the request is sent and keeps driving;
 * the page navigates the instant the API succeeds (nothing waits for the
 * animation); if the order is refused the van reverses into the button,
 * which shows the refusal, and the server's words appear above the bar.
 * The button, Enter in a field and the confirm all reach the SAME
 * request, and the browser's own `required` checks still run first.
 */
export default function NewStoreOrderPage(): ReactElement {
  const me = useStoreIdentity();
  const router = useRouter();
  const mayReadCatalogue = can(me, 'catalogue.view');
  const catalogue = useStoreCatalogue(mayReadCatalogue);
  const create = useCreateStoreOrder();

  const [lines, setLines] = useState<Line[]>([
    { key: 1, variantId: '', quantity: '1', retail: '' },
  ]);
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
  const [error, setError] = useState<string | null>(null);
  /** "Place order" asks once before it sends. */
  const [confirmPlace, setConfirmPlace] = useState(false);
  /** The van's BUSY state: from the send until the page leaves (or a refusal). */
  const [placing, setPlacing] = useState(false);
  /** Drives the van's error state only: set when the order did not go through. */
  const [placeFailed, setPlaceFailed] = useState(false);

  const items = useMemo(() => catalogue.data?.items ?? [], [catalogue.data]);
  const byId = useMemo(() => new Map(items.map((i) => [i.variantId, i])), [items]);

  const retailTotal = lines.reduce((sum, l) => {
    const q = Number(l.quantity);
    const r = Number(l.retail);
    return Number.isFinite(q) && Number.isFinite(r) ? sum + q * r : sum;
  }, 0);
  const collectDefault = retailTotal + (Number(deliveryFee) || 0);
  const chosenCount = lines.filter((l) => l.variantId !== '').length;

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
        paymentMode: 'COD',
        ...(deliveryFee.trim() === '' ? {} : { deliveryFeeInr: Number(deliveryFee) }),
        ...(codAmount.trim() === '' ? {} : { codAmountInr: Number(codAmount) }),
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        ...(acknowledgeDuplicate ? { acknowledgeDuplicate: true } : {}),
        items: lines
          .filter((l) => l.variantId !== '')
          .map((l) => ({
            variantId: l.variantId,
            quantity: Number(l.quantity),
            retailUnitPriceInr: Number(l.retail),
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

  /** What "Place order" does, from the button or from Enter in a field:
   *  the browser's own checks have already run, so ask once. */
  function requestSubmit(): void {
    setConfirmPlace(true);
  }

  const header = (
    <PageHeader
      title="New order"
      subtitle="Pick products from your catalogue, set what you sell them for, and say who they are going to."
    />
  );

  // The picker IS the catalogue: without `catalogue.view` the query never
  // runs, and `isPending` would stay true for ever.
  if (!mayReadCatalogue) {
    return (
      <div className="ro-page">
        {header}
        <EmptyState
          icon={<BookOpen size={20} />}
          title="You cannot see the catalogue"
          description="Placing an order starts from your store’s catalogue, and your role cannot open it. Ask an owner or admin of your store to change your role, or to place the order."
        />
      </div>
    );
  }
  if (catalogue.isPending) {
    return (
      <div className="ro-page">
        {header}
        <SkeletonRows rows={4} cols={3} label="Loading your catalogue" />
      </div>
    );
  }
  if (catalogue.isError) {
    return (
      <div className="ro-page">
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
      <div className="ro-page">
        {header}
        <EmptyState
          icon={<PackageSearch size={20} />}
          title="Nothing to sell yet"
          description="The seller has not turned any products on for your store. Ask them to, then come back."
        />
      </div>
    );
  }

  return (
    <form
      className="ro-page"
      onSubmit={(e) => {
        e.preventDefault();
        requestSubmit();
      }}
    >
      <BackLink href="/orders" icon={<ArrowLeft size={14} aria-hidden />}>
        Orders
      </BackLink>
      {header}

      {/* A progress header over the SAME single form: it marks the
          section in view and scrolls to one on click. Nothing is hidden
          or unmounted — every field stays in the one form. */}
      <Stepper
        mode="sections"
        label="Order form sections"
        sticky
        steps={[
          { id: 'ro-new-products', label: 'Products', icon: <PackageSearch size={15} /> },
          { id: 'ro-new-customer', label: 'Customer', icon: <UserRound size={15} /> },
          { id: 'ro-new-payment', label: 'Payment', icon: <Banknote size={15} /> },
        ]}
      />

      <RoSection id="ro-new-products" title="Products">
        <div className="ro-stack ro-stack--tight">
          <ul className="ro-lines">
            {lines.map((l) => {
              const item = byId.get(l.variantId);
              return (
                <li key={l.key} className="ro-line">
                  <Select
                    label="Product"
                    aria-label="Product"
                    value={l.variantId}
                    onChange={(e) => {
                      const picked = byId.get(e.target.value);
                      update(l.key, {
                        variantId: e.target.value,
                        retail:
                          l.retail === '' && picked?.suggestedRetailInr
                            ? picked.suggestedRetailInr
                            : l.retail,
                      });
                    }}
                  >
                    <option value="">Choose a product</option>
                    {items.map((i) => (
                      <option key={i.variantId} value={i.variantId} disabled={i.availableQty === 0}>
                        {i.title}
                        {i.variantLabel !== null ? ` · ${i.variantLabel}` : ''} ({i.skuCode}) —{' '}
                        {i.availableQty} available
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
                  <TextField
                    label="Sell at (₹ each)"
                    aria-label="Retail price per unit"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={l.retail}
                    onChange={(e) => update(l.key, { retail: e.target.value })}
                    hint={item === undefined ? undefined : <>Sell {rangeWords(item)}</>}
                  />
                  <div className="ro-line__remove">
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
                  {item !== undefined ? (
                    <p className="ro-line__note">
                      You pay the seller <Money amount={item.transferPriceInr} convert={false} />{' '}
                      each · {item.availableQty} available to your store
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="ro-row">
            <Button
              type="button"
              variant="ghost"
              icon={<Plus size={15} />}
              onClick={() => {
                setLines((ls) => [
                  ...ls,
                  { key: nextKey, variantId: '', quantity: '1', retail: '' },
                ]);
                setNextKey((k) => k + 1);
              }}
            >
              Add another product
            </Button>
          </div>
        </div>
      </RoSection>

      <RoSection id="ro-new-customer" title="Customer">
        <div className="ro-grid-2">
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
      </RoSection>

      <RoSection id="ro-new-payment" title="Payment">
        <div className="ro-stack ro-stack--tight">
          <div className="ro-grid-3">
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
          <Notice tone="info" icon={<Banknote size={16} />}>
            <span>
              Cash on delivery only for now. Skydrop’s call centre confirms every order with the
              customer before it is packed.
            </span>
          </Notice>
        </div>
      </RoSection>

      {error !== null ? (
        <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
          <p className="ro-error">{error}</p>
          {error.includes('DUPLICATE_ORDER_SUSPECTED') ? (
            <Checkbox
              label="This is a separate order — place it anyway"
              checked={acknowledgeDuplicate}
              onChange={(e) => setAcknowledgeDuplicate(e.target.checked)}
            />
          ) : null}
        </Notice>
      ) : null}

      {/* The sticky bar: the two things checked before committing — how
          many products, and that the button is right there. */}
      <div className="ro-bar">
        <p className="ro-bar__summary">
          {chosenCount === 0
            ? 'No products chosen yet'
            : `${chosenCount} ${chosenCount === 1 ? 'product' : 'products'} · cash on delivery`}
        </p>
        <div className="ro-bar__actions">
          <LinkButton href="/orders" variant="ghost">
            Cancel
          </LinkButton>
          <VanDriveOffButton
            type="submit"
            mode="while-busy"
            variant="primary"
            className="ro-nowrap"
            icon={<Send size={15} />}
            label="Place order"
            busyLabel="Placing…"
            errorLabel="Not placed"
            state={placing ? 'busy' : placeFailed ? 'error' : 'idle'}
            onAction={async () => {
              requestSubmit();
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
          <>
            {codAmount.trim() === '' ? (
              <Money amount={collectDefault} convert={false} />
            ) : (
              <Money amount={codAmount.trim()} convert={false} />
            )}{' '}
            to collect
          </>
        }
        consequence={`It is placed for ${
          chosenCount === 1 ? 'one product' : `${chosenCount} products`
        }, cash on delivery, and goes to Skydrop’s call centre, who confirm it with the customer before it is packed.`}
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
