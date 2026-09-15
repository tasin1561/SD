'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  FormActions,
  FormField,
  Input,
  LoadingState,
  Money,
  PageHeader,
  Section,
  Select,
  Textarea,
} from '@skydrop/ui/components';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { useStoreCatalogue, type StoreCatalogueItem } from '@/lib/catalogue-hooks';
import { useCreateStoreOrder } from '@/lib/order-hooks';

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

  const items = useMemo(() => catalogue.data?.items ?? [], [catalogue.data]);
  const byId = useMemo(() => new Map(items.map((i) => [i.variantId, i])), [items]);

  const retailTotal = lines.reduce((sum, l) => {
    const q = Number(l.quantity);
    const r = Number(l.retail);
    return Number.isFinite(q) && Number.isFinite(r) ? sum + q * r : sum;
  }, 0);
  const collectDefault = retailTotal + (Number(deliveryFee) || 0);

  function update(key: number, patch: Partial<Line>): void {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
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
      router.push(`/orders/${created.id}`);
    } catch (err) {
      setError(serverVerdict(err));
    }
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
      <div className="space-y-6">
        {header}
        <EmptyState
          title="You cannot see the catalogue"
          description="Placing an order starts from your store’s catalogue, and your role cannot open it. Ask an owner or admin of your store to change your role, or to place the order."
        />
      </div>
    );
  }
  if (catalogue.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingState label="Loading your catalogue" rows={4} />
      </div>
    );
  }
  if (catalogue.isError) {
    return (
      <div className="space-y-6">
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
      <div className="space-y-6">
        {header}
        <EmptyState
          title="Nothing to sell yet"
          description="The seller has not turned any products on for your store. Ask them to, then come back."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/orders"
        className="text-text-muted hover:text-text-body inline-flex items-center gap-1.5 text-xs"
      >
        <ArrowLeft size={12} /> Orders
      </Link>
      {header}
      <form onSubmit={(e) => void submit(e)} className="space-y-6">
        <Section title="Products">
          <Card>
            <CardBody>
              <div className="space-y-4">
                {lines.map((l) => {
                  const item = byId.get(l.variantId);
                  return (
                    <div
                      key={l.key}
                      className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_90px_130px_auto]"
                    >
                      <FormField label="Product">
                        <Select
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
                            <option
                              key={i.variantId}
                              value={i.variantId}
                              disabled={i.availableQty === 0}
                            >
                              {i.title}
                              {i.variantLabel !== null ? ` · ${i.variantLabel}` : ''} ({i.skuCode})
                              — {i.availableQty} available
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField label="Qty">
                        <Input
                          aria-label="Quantity"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={l.quantity}
                          onChange={(e) => update(l.key, { quantity: e.target.value })}
                        />
                      </FormField>
                      <FormField
                        label="Sell at (₹ each)"
                        hint={item === undefined ? undefined : <>Sell {rangeWords(item)}</>}
                      >
                        <Input
                          aria-label="Retail price per unit"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={l.retail}
                          onChange={(e) => update(l.key, { retail: e.target.value })}
                        />
                      </FormField>
                      <div className="flex items-end">
                        {lines.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="md"
                            aria-label="Remove this product"
                            onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                          >
                            <Trash2 size={14} />
                          </Button>
                        ) : null}
                      </div>
                      {item !== undefined ? (
                        <p className="text-text-faint text-xs sm:col-span-4">
                          You pay the seller{' '}
                          <Money amount={item.transferPriceInr} convert={false} /> each ·{' '}
                          {item.availableQty} available to your store
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
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
            </CardBody>
          </Card>
        </Section>

        <Section title="Customer">
          <Card>
            <CardBody>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Name" required>
                  <Input value={name} onChange={(e) => setName(e.target.value)} required />
                </FormField>
                <FormField label="Phone" hint="With the country code, e.g. +919876543210" required>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    inputMode="tel"
                    required
                  />
                </FormField>
                <FormField label="Email (optional)">
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </FormField>
                <FormField label="PIN code" required>
                  <Input
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    inputMode="numeric"
                    required
                  />
                </FormField>
                <FormField label="Address" required>
                  <Input value={line1} onChange={(e) => setLine1(e.target.value)} required />
                </FormField>
                <FormField
                  label="Landmark"
                  hint="What a driver looks for to find the door"
                  required
                >
                  <Input value={landmark} onChange={(e) => setLandmark(e.target.value)} required />
                </FormField>
              </div>
            </CardBody>
          </Card>
        </Section>

        <Section title="Payment">
          <Card>
            <CardBody>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FormField label="Delivery charge to the customer (₹, optional)">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(e.target.value)}
                  />
                </FormField>
                <FormField
                  label="Cash to collect (₹)"
                  hint={
                    <>
                      Leave blank to collect <Money amount={collectDefault} convert={false} />
                    </>
                  }
                >
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={codAmount}
                    onChange={(e) => setCodAmount(e.target.value)}
                  />
                </FormField>
                <FormField label="Your reference (optional)">
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                </FormField>
              </div>
              <div className="mt-3">
                <FormField label="Notes for the call centre (optional)">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={2000}
                  />
                </FormField>
              </div>
              <p className="text-text-faint mt-2 text-xs">
                Cash on delivery only for now. Skydrop’s call centre confirms every order with the
                customer before it is packed.
              </p>
            </CardBody>
          </Card>
        </Section>

        {error !== null ? (
          <div role="alert" className="space-y-2">
            <p className="text-critical text-sm">{error}</p>
            {error.includes('DUPLICATE_ORDER_SUSPECTED') ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledgeDuplicate}
                  onChange={(e) => setAcknowledgeDuplicate(e.target.checked)}
                />
                This is a separate order — place it anyway
              </label>
            ) : null}
          </div>
        ) : null}

        <FormActions>
          <Link href="/orders">
            <Button type="button" variant="ghost" size="md">
              Cancel
            </Button>
          </Link>
          <Button type="submit" variant="primary" size="md" disabled={create.isPending}>
            {create.isPending ? 'Placing…' : 'Place order'}
          </Button>
        </FormActions>
      </form>
    </div>
  );
}
