'use client';

import { notFound, useRouter } from 'next/navigation';
import { useOrderPageV2Enabled } from '@/lib/address-check-hooks';
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
  Wallet,
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
import { ChoiceCards } from '@skydrop/ui/app/choice-cards';
import { NumberStepper } from '@skydrop/ui/app/number-stepper';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { can } from '@/lib/page-access';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import { richMessage, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { useStoreCatalogue, type StoreCatalogueItem } from '@/lib/catalogue-hooks';
import { useCreateStoreOrder } from '@/lib/order-hooks';
import { BackLink, LinkButton, Notice, RoSection } from '../_components/orders-parts';
import { useUatField } from '@skydrop/ui/app/uat-fields';

interface Line {
  readonly key: number;
  readonly variantId: string;
  readonly quantity: string;
  readonly retail: string;
}

function rangeWords(i: StoreCatalogueItem, t: Translate<MessageKey>): ReactNode {
  const m = (v: string): ReactNode => <Money amount={v} convert={false} />;
  if (i.minRetailInr === null && i.maxRetailInr === null) return t('neworder.range.any');
  if (i.minRetailInr !== null && i.maxRetailInr !== null)
    return richMessage(t('neworder.range.between'), {
      min: m(i.minRetailInr),
      max: m(i.maxRetailInr),
    });
  return i.minRetailInr !== null
    ? richMessage(t('neworder.range.atLeast'), { min: m(i.minRetailInr) })
    : richMessage(t('neworder.range.upTo'), { max: m(i.maxRetailInr ?? '0') });
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
/**
 * Order page v2 — a COPY of `/orders/new` with live address checking.
 *
 * The old page is untouched and stays the one every store uses until
 * `orders.page_v2_audience` says otherwise. The `notFound()` below
 * hides this route from anyone outside the pilot, and that hiding is
 * COSMETIC (FE-2): the API answers 404 on every address-check route for
 * an account the flag does not cover, which is the real boundary.
 */
export default function NewStoreOrderPageV2(): ReactElement {
  const t = useT();
  const gate = useOrderPageV2Enabled();
  // A failed check is not a reason to show an unproven page — the same
  // fail-closed rule the server gate uses.
  if (gate.isPending) return <SkeletonRows rows={6} cols={2} label={t('neworder.loadingForm')} />;
  if (gate.data?.enabled !== true) notFound();
  return <NewStoreOrderPageForm />;
}

function NewStoreOrderPageForm(): ReactElement {
  const t = useT();
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
  // Hidden for UAT (owner, 2026-10-26), code intact. Not rendered means
  // it stays '' and the payload omits it, which is the same 0 the
  // server has always defaulted to. Reversible from UAT Settings.
  const showDeliveryFee = useUatField('orderDeliveryFee');
  const [codAmount, setCodAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [acknowledgeDuplicate, setAcknowledgeDuplicate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** "Place order" asks once before it sends. */
  const [confirmPlace, setConfirmPlace] = useState(false);
  /**
   * COD or prepaid.
   *
   * Prepaid has been a real path since RS-6 phase 3c — the store's wallet
   * pays the seller's transfer price and the store's share of the delivery
   * fee at confirmation, refused as `STORE_BALANCE_INSUFFICIENT` inside the
   * create transaction if it cannot cover them. This form hard-coded 'COD'
   * and carried a notice saying cash on delivery was the only option, so a
   * store could not place a prepaid order at all even though the API, the
   * CSV importer and the API-key path all accepted one.
   */
  const [payment, setPayment] = useState<'COD' | 'PREPAID'>('COD');
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
  /*
    What the wallet pays for the GOODS on a prepaid order.

    The store's share of the delivery fee is added to it at confirmation
    and is deliberately NOT guessed at here: the split lives on the terms
    version the order will be placed under, which this form does not hold.
    Naming the goods and saying the share follows is honest; inventing a
    total would be a figure the wallet then disagrees with.
  */
  const prepaidGoods = lines.reduce((sum, l) => {
    const q = Number(l.quantity);
    const transfer = Number(byId.get(l.variantId)?.transferPriceInr ?? NaN);
    return Number.isFinite(q) && Number.isFinite(transfer) ? sum + q * transfer : sum;
  }, 0);
  const prepaid = payment === 'PREPAID';
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
        paymentMode: payment,
        /*
          Both of these describe the COLLECTABLE, and a prepaid order has
          none: `deliveryFeeInr` is documented as "added to the collectable
          amount", and `codAmountInr` is REFUSED outright for PREPAID
          ("codAmountInr must be absent for PREPAID orders"). Sending either
          would be a 400 the store could do nothing about.
        */
        ...(prepaid || deliveryFee.trim() === '' ? {} : { deliveryFeeInr: Number(deliveryFee) }),
        ...(prepaid || codAmount.trim() === '' ? {} : { codAmountInr: Number(codAmount) }),
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
      setError(verdict(err, t));
      setPlaceFailed(true);
      setPlacing(false);
    }
  }

  /** What "Place order" does, from the button or from Enter in a field:
   *  the browser's own checks have already run, so ask once. */
  function requestSubmit(): void {
    setConfirmPlace(true);
  }

  const header = <PageHeader title={t('neworder.title')} subtitle={t('neworder.subtitle')} />;

  // The picker IS the catalogue: without `catalogue.view` the query never
  // runs, and `isPending` would stay true for ever.
  if (!mayReadCatalogue) {
    return (
      <div className="ro-page">
        {header}
        <EmptyState
          icon={<BookOpen size={20} />}
          title={t('neworder.noAccess.title')}
          description={t('neworder.noAccess.body')}
        />
      </div>
    );
  }
  if (catalogue.isPending) {
    return (
      <div className="ro-page">
        {header}
        <SkeletonRows rows={4} cols={3} label={t('neworder.loadingCatalogue')} />
      </div>
    );
  }
  if (catalogue.isError) {
    return (
      <div className="ro-page">
        {header}
        <ErrorState message={verdict(catalogue.error, t)} retry={() => void catalogue.refetch()} />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="ro-page">
        {header}
        <EmptyState
          icon={<PackageSearch size={20} />}
          title={t('neworder.empty.title')}
          description={t('neworder.empty.body')}
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
        {t('neworder.back')}
      </BackLink>
      {header}

      {/* A progress header over the SAME single form: it marks the
          section in view and scrolls to one on click. Nothing is hidden
          or unmounted — every field stays in the one form. */}
      <Stepper
        mode="sections"
        label={t('neworder.stepper.label')}
        sticky
        steps={[
          {
            id: 'ro-new-products',
            label: t('neworder.step.products'),
            icon: <PackageSearch size={15} />,
          },
          {
            id: 'ro-new-customer',
            label: t('neworder.step.customer'),
            icon: <UserRound size={15} />,
          },
          { id: 'ro-new-payment', label: t('neworder.step.payment'), icon: <Banknote size={15} /> },
        ]}
      />

      <RoSection id="ro-new-products" title={t('neworder.step.products')}>
        <div className="ro-stack ro-stack--tight">
          <ul className="ro-lines">
            {lines.map((l) => {
              const item = byId.get(l.variantId);
              return (
                <li key={l.key} className="ro-line">
                  <Select
                    label={t('neworder.product')}
                    aria-label={t('neworder.product')}
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
                    <option value="">{t('neworder.chooseProduct')}</option>
                    {items.map((i) => (
                      <option key={i.variantId} value={i.variantId} disabled={i.availableQty === 0}>
                        {t('neworder.optionLabel', {
                          label: `${i.title}${i.variantLabel !== null ? ` · ${i.variantLabel}` : ''} (${i.skuCode})`,
                          n: i.availableQty,
                        })}
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
                  <TextField
                    label={t('neworder.sellAt')}
                    aria-label={t('neworder.retailPerUnit')}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={l.retail}
                    onChange={(e) => update(l.key, { retail: e.target.value })}
                    hint={
                      item === undefined
                        ? undefined
                        : richMessage(t('neworder.sell'), { range: rangeWords(item, t) })
                    }
                  />
                  <div className="ro-line__remove">
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
                  {item !== undefined ? (
                    <p className="ro-line__note">
                      {richMessage(t('neworder.lineNote'), {
                        price: <Money amount={item.transferPriceInr} convert={false} />,
                        n: item.availableQty,
                      })}
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
              {t('neworder.addAnother')}
            </Button>
          </div>
        </div>
      </RoSection>

      <RoSection id="ro-new-customer" title={t('neworder.step.customer')}>
        <div className="ro-grid-2">
          {/* The store's own order id, FIRST — owner, 2026-10-26. It is
              the number they already have in their own system and the
              one they quote when they ring about this parcel, so it is
              the first thing they copy across, not the last. */}
          <TextField
            label={t('neworder.orderId')}
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
      </RoSection>

      <RoSection id="ro-new-payment" title={t('neworder.step.payment')}>
        <div className="ro-stack ro-stack--tight">
          <ChoiceCards
            label={t('neworder.paidQuestion')}
            name="store-order-payment"
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

          <div className="ro-grid-3">
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
            <Notice tone="info" icon={<Wallet size={16} />}>
              <span>
                {prepaidGoods > 0
                  ? richMessage(t('neworder.prepaidNote.withGoods'), {
                      amount: <Money amount={prepaidGoods} convert={false} />,
                    })
                  : t('neworder.prepaidNote.noGoods')}
              </span>
            </Notice>
          ) : (
            <Notice tone="info" icon={<Banknote size={16} />}>
              <span>{t('neworder.codNote')}</span>
            </Notice>
          )}
        </div>
      </RoSection>

      {error !== null ? (
        <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
          <p className="ro-error">{error}</p>
          {error.includes('DUPLICATE_ORDER_SUSPECTED') ? (
            <Checkbox
              label={t('neworder.duplicate')}
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
            ? t('neworder.summary.none')
            : t('neworder.summary', {
                products: t(
                  chosenCount === 1 ? 'neworder.products.one' : 'neworder.products.other',
                  {
                    n: chosenCount,
                  },
                ),
                mode: t(prepaid ? 'neworder.mode.prepaid' : 'neworder.mode.cod'),
              })}
        </p>
        <div className="ro-bar__actions">
          <LinkButton href="/orders" variant="ghost">
            {t('neworder.cancel')}
          </LinkButton>
          <VanDriveOffButton
            type="submit"
            mode="while-busy"
            variant="primary"
            className="ro-nowrap"
            icon={<Send size={15} />}
            label={t('neworder.place')}
            busyLabel={t('neworder.placing')}
            errorLabel={t('neworder.notPlaced')}
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
        title={t('neworder.confirm.title')}
        entity={`${name.trim()} · ${phone.trim()}`}
        amount={
          prepaid
            ? richMessage(t('neworder.confirm.prepaidAmount'), {
                amount: <Money amount={prepaidGoods} convert={false} />,
              })
            : richMessage(t('neworder.confirm.toCollect'), {
                amount:
                  codAmount.trim() === '' ? (
                    <Money amount={collectDefault} convert={false} />
                  ) : (
                    <Money amount={codAmount.trim()} convert={false} />
                  ),
              })
        }
        consequence={t('neworder.confirm.consequence', {
          products:
            chosenCount === 1
              ? t('neworder.confirm.products.one')
              : t('neworder.confirm.products.other', { n: chosenCount }),
          mode: t(prepaid ? 'neworder.confirm.mode.prepaid' : 'neworder.confirm.mode.cod'),
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
