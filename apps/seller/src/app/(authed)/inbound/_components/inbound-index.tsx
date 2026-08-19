'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ConsignmentRoute, ConsignmentStatus } from '@skydrop/db';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Num,
  PageHeader,
  Section,
  Select,
  SkeletonRows,
  StatusBadge,
  TBody,
  Table,
  TablePaginator,
  Td,
  THead,
  Th,
  Toolbar,
  Tr,
} from '@skydrop/ui/components';
import { consignmentStatusKind } from '@skydrop/ui/status';
import { useConsignments, useDeclareConsignment } from '@/lib/account-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';
import type { SellerVariantSearchHit } from '@skydrop/api-client';
import { VariantPicker } from './variant-picker';
import { productCount, routeWords, shortDate, statusWords } from './consignment-words';

const PAGE_SIZE = 25;

/**
 * Inbound consignments — stock on its way to the Indian warehouse.
 *
 * A consignment is a JOURNEY now, not an arrival. It has a route, up to
 * two counts, and a timeline the seller can watch; this screen is the
 * list, and `/inbound/[id]` is where the movement is visible.
 *
 * The route is the one question this form asks that the old one did not,
 * and it is the one that decides what we charge: shipping to Dhaka means
 * we move the goods across the border and bill the freight, shipping to
 * India means the seller has already done that themselves.
 */
/**
 * A consignment line as the SELLER sees it, not as the API takes it.
 *
 * The wire type is `{ variantId, expectedQty, unitCostInr? }` — enough to
 * receive against and nothing anyone can read. These carry the name, SKU
 * and picture too, and are mapped down at submit.
 */
interface StagedLine {
  variantId: string;
  label: string;
  skuCode: string;
  imageUrl: string | null;
  expectedQty: number;
  unitCostInr?: number;
  manufacturedAt?: string;
  expiresAt?: string;
}

export function InboundIndex(): ReactElement {
  const router = useRouter();
  const canManage = can(useSellerIdentity(), 'inbound.manage');
  const [status, setStatus] = useState<ConsignmentStatus | ''>('');
  const [route, setRoute] = useState<ConsignmentRoute | ''>('');
  const [page, setPage] = useState(1);
  const [announcing, setAnnouncing] = useState(false);

  const list = useConsignments({ status, route, page, pageSize: PAGE_SIZE });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const moving = items.filter(
    (c) => c.status !== ConsignmentStatus.COMPLETED && c.status !== ConsignmentStatus.CANCELLED,
  );
  const varied = items.filter((c) => c.receipts.some((r) => r.hasDiscrepancies));

  return (
    <div>
      <PageHeader
        title="Add stock"
        subtitle="Consignments on their way to the Indian warehouse — where each one is now, and what was counted when it got there."
        action={
          canManage ? (
            // PRIMARY, and the larger size. `Button` defaults to
            // secondary, so the one action this page exists for was
            // rendering as an outline in the corner — quieter than the
            // filters below it.
            <Button variant="primary" size="md" onClick={() => setAnnouncing(true)}>
              Announce a consignment
            </Button>
          ) : undefined
        }
      />

      {/*
        One line, not three tiles. Three of them for three small numbers
        was most of the screen above the fold, and the tallest hint forced
        the other two to match its height — so a page showing nothing at
        all opened with a wall of empty boxes.

        "Shown" is gone entirely: the table underneath already says how
        many rows there are, and a count of the thing directly below it is
        not a statistic.
      */}
      <p className="text-text-muted mb-3 text-sm">
        <Num value={moving.length} /> still travelling
        <span className="text-text-faint"> — announced, in Dhaka, or in the air</span>
        {varied.length > 0 && (
          <>
            {' · '}
            <span className="text-[var(--status-pending-fg)]">
              <Num value={varied.length} /> counted differently
            </span>
            <span className="text-text-faint"> — nothing is blocked by it</span>
          </>
        )}
      </p>

      <Toolbar>
        <label className="text-text-muted text-xs" htmlFor="cn-status">
          Where it is
        </label>
        <Select
          id="cn-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ConsignmentStatus | '');
            setPage(1);
          }}
          className="w-56"
        >
          <option value="">Anywhere</option>
          {Object.values(ConsignmentStatus).map((s) => (
            <option key={s} value={s}>
              {statusWords(s)}
            </option>
          ))}
        </Select>
        <label className="text-text-muted text-xs" htmlFor="cn-route">
          Route
        </label>
        <Select
          id="cn-route"
          value={route}
          onChange={(e) => {
            setRoute(e.target.value as ConsignmentRoute | '');
            setPage(1);
          }}
          className="w-56"
        >
          <option value="">Either route</option>
          {Object.values(ConsignmentRoute).map((r) => (
            <option key={r} value={r}>
              {routeWords(r).title}
            </option>
          ))}
        </Select>
      </Toolbar>

      <Card>
        {list.isLoading ? (
          <SkeletonRows rows={5} />
        ) : list.isError ? (
          <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No stock announced yet"
            description="Announce a consignment before it ships so receiving knows to expect it — and so you can follow it."
            action={
              canManage ? (
                <Button variant="primary" size="md" onClick={() => setAnnouncing(true)}>
                  Announce a consignment
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>Consignment</Th>
                  <Th>Route</Th>
                  <Th align="right">Products</Th>
                  <Th>Your reference</Th>
                  <Th>Expected</Th>
                  <Th>Where it is</Th>
                </Tr>
              </THead>
              <TBody>
                {items.map((c) => (
                  <Tr
                    key={c.id}
                    // `onActivate`, not a raw onClick: it already skips a
                    // click that landed on a link or button, and one that
                    // ended a text selection. The <a> below stays — it is
                    // the keyboard path, and a <tr> has no Enter key.
                    onActivate={() => router.push(`/inbound/${c.id}`)}
                  >
                    <Td>
                      <Link
                        href={`/inbound/${c.id}`}
                        className="text-accent hover:underline font-mono text-xs"
                      >
                        {c.consignmentNumber}
                      </Link>
                    </Td>
                    <Td>{routeWords(c.route).title}</Td>
                    <Td align="right">
                      <Num value={productCount(c)} />
                    </Td>
                    <Td>{c.sellerReference ?? '—'}</Td>
                    <Td>{shortDate(c.expectedArrivalAt)}</Td>
                    <Td>
                      <StatusBadge
                        kind={consignmentStatusKind(c.status)}
                        label={statusWords(c.status)}
                      />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <TablePaginator page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </Card>

      <p className="text-text-muted mt-3 text-sm">
        Open a consignment to see its timeline, and what each warehouse counted against what you
        declared.
      </p>

      <AnnounceConsignment open={announcing} onClose={() => setAnnouncing(false)} />
    </div>
  );
}

/**
 * Declaring a consignment means saying where it is going and what is in
 * it.
 *
 * The API requires at least one line, and that is the right shape: a
 * consignment with no contents tells receiving a box is coming but not
 * what to count, which is the same as not declaring it. The warehouse is
 * deliberately NOT asked for — the route decides which building, and
 * there is no seller-visible endpoint that lists warehouses.
 *
 * VIA_BD can be refused outright (`BD_WAREHOUSE_NOT_CONFIGURED`) when no
 * Bangladesh warehouse exists yet. That refusal is NOT pre-empted here
 * (FE-2): the option stays offered and the server's verdict is shown
 * verbatim, because whether a BD warehouse exists is the server's fact
 * and a hidden option is a fact nobody can act on.
 */
function AnnounceConsignment({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement {
  const create = useDeclareConsignment();
  const [route, setRoute] = useState<ConsignmentRoute>(ConsignmentRoute.DIRECT_IN);
  /** Collapsed by default — see the note on the info toggle below. */
  const [routeInfo, setRouteInfo] = useState(false);
  const [expectedArrivalAt, setExpectedArrivalAt] = useState('');
  const [sellerReference, setSellerReference] = useState('');
  /**
   * Staged rows carry what the seller needs to SEE, not just what the
   * API needs to receive. The list used to print `variantId`, which is a
   * uuid — the seller had just chosen "Aviator OG Sunglass — Black" and
   * got back 01a015ae-3efe-… as confirmation.
   */
  const [lines, setLines] = useState<StagedLine[]>([]);
  const [picked, setPicked] = useState<SellerVariantSearchHit | null>(null);
  const [variantLabel, setVariantLabel] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  /**
   * Most goods are not dated. Asking every consignment for a manufacture
   * and expiry date puts two empty boxes in front of someone shipping
   * sunglasses, so the dates are opt-in per product — ticked when the
   * thing in the box actually carries them.
   */
  const [hasDates, setHasDates] = useState(false);
  const [manufacturedAt, setManufacturedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  function close(): void {
    setRoute(ConsignmentRoute.DIRECT_IN);
    setExpectedArrivalAt('');
    setSellerReference('');
    setLines([]);
    setPicked(null);
    setVariantLabel(null);
    setQty('');
    setUnitCost('');
    setHasDates(false);
    setManufacturedAt('');
    setExpiresAt('');
    create.reset();
    onClose();
  }

  /** The row being typed, if it is complete enough to stand as one. */
  function draftLine(): StagedLine | null {
    if (picked === null || !(Number(qty) > 0)) return null;
    return {
      variantId: picked.id,
      label: variantLabel ?? picked.productName,
      skuCode: picked.skuCode,
      imageUrl: picked.primaryImageUrl,
      expectedQty: Number(qty),
      ...(unitCost.trim() === '' ? {} : { unitCostInr: Number(unitCost) }),
      // Only when the box is ticked AND a date was entered — an unticked
      // row must not carry a stale date somebody typed then hid.
      ...(hasDates && manufacturedAt !== ''
        ? { manufacturedAt: new Date(manufacturedAt).toISOString() }
        : {}),
      ...(hasDates && expiresAt !== '' ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
    };
  }

  function addLine(): void {
    const draft = draftLine();
    if (draft === null) return;
    setLines((ls) => [...ls, draft]);
    // Clearing the LABEL too is what lets a second product be added at
    // all: leaving it made the picker keep showing the last choice, so
    // the form looked stuck on one item.
    setPicked(null);
    setVariantLabel(null);
    setQty('');
    setUnitCost('');
    setHasDates(false);
    setManufacturedAt('');
    setExpiresAt('');
  }

  const lineReady = draftLine() !== null;
  // Announce takes the row being typed as well, so filling the fields
  // and pressing the button does what it looks like it does. "Add
  // product" is for adding ANOTHER, not a toll on the first.
  const draft = draftLine();
  const pendingLines = draft === null ? lines : [...lines, draft];

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      title="Announce a consignment"
      description="Say where you are sending it and what is in it, so receiving knows what to count against."
    >
      <Section
        title="Where are you sending it?"
        // The full explanation of each route used to sit inside the two
        // choices, which made them tall enough to be most of the modal —
        // and a seller picking the same route for the tenth time read
        // none of it. It moved behind this toggle: the choice carries
        // enough to decide, the paragraph is one click away, and neither
        // is lost.
        action={
          <button
            type="button"
            onClick={() => setRouteInfo((v) => !v)}
            aria-expanded={routeInfo}
            aria-label={routeInfo ? 'Hide what the routes mean' : 'What do the routes mean?'}
            className="text-text-muted hover:text-text-strong inline-flex h-8 w-8 items-center justify-center rounded-full"
          >
            <Info size={16} aria-hidden />
          </button>
        }
      >
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Route</legend>
          {Object.values(ConsignmentRoute).map((r) => {
            const words = routeWords(r);
            const chosen = route === r;
            return (
              <label
                key={r}
                className={`border-border flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-[6px] border px-3 py-2 ${
                  chosen ? 'bg-[var(--color-accent-tint)] border-accent' : 'hover:bg-surface-hover'
                }`}
              >
                <input
                  type="radio"
                  name="cn-route-choice"
                  value={r}
                  checked={chosen}
                  onChange={() => setRoute(r)}
                  className="h-4 w-4 shrink-0"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-text-strong text-sm font-medium">{words.title}</span>
                  <span className="text-text-muted text-xs">{words.hint}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {routeInfo && (
          <dl className="text-text-muted mt-2 space-y-1.5 text-xs leading-snug">
            {Object.values(ConsignmentRoute).map((r) => (
              <div key={r}>
                <dt className="text-text-strong inline font-medium">{routeWords(r).title}: </dt>
                <dd className="inline">{routeWords(r).blurb}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section title="What is in it?">
        <p className="text-text-muted mb-3 text-xs">
          At least one product. Unit cost is optional but makes landed cost and margin accurate.
        </p>
        {/*
          Four columns, with the button in the last one. It belongs to
          the row it adds — parked on a line of its own underneath, it
          read as a second opinion on the whole form and sat close enough
          to Announce to be mistaken for it.
        */}
        <div className="grid items-start gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
          <FormField label="Item" htmlFor="cn-variant">
            <VariantPicker
              id="cn-variant"
              value={picked?.id ?? ''}
              label={variantLabel}
              onPick={(hit, shown) => {
                setPicked(hit);
                setVariantLabel(shown);
              }}
            />
          </FormField>
          <FormField label="Quantity" htmlFor="cn-qty">
            <Input
              id="cn-qty"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </FormField>
          <FormField label="Unit cost (₹)" htmlFor="cn-cost" hint="Optional">
            <Input
              id="cn-cost"
              type="number"
              min={0}
              step="0.01"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
          </FormField>
          {/*
            Inside a FormField with an INVISIBLE label, so it inherits the
            same vertical rhythm as the three inputs and lands on their
            baseline. Aligning the column with `justify-end` instead put
            it at the bottom of the tallest column — and "Unit cost"
            carries an "Optional" hint, so the button sat a line low.

            Always PRIMARY, never dimmed to secondary while incomplete.
            The disabled state already reads as not-yet (50% opacity, no
            pointer); switching colour as well made it recede exactly when
            somebody is looking for what to press next.
          */}
          <FormField label={<span aria-hidden>&nbsp;</span>}>
            <span className="sr-only">Add this product to the consignment</span>
            <Button
              variant="primary"
              disabled={!lineReady}
              onClick={addLine}
              className="h-10 w-full whitespace-nowrap sm:w-auto sm:px-6"
            >
              Add
            </Button>
          </FormField>
        </div>

        <label className="text-text-body mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hasDates}
            onChange={(e) => {
              setHasDates(e.target.checked);
              if (!e.target.checked) {
                // Clear on untick, so a hidden field cannot travel with
                // the row it is no longer shown on.
                setManufacturedAt('');
                setExpiresAt('');
              }
            }}
            className="h-4 w-4"
          />
          Has manufacture / expiry dates
        </label>
        {hasDates && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <FormField label="Manufactured" htmlFor="cn-mfg" hint="Optional">
              <Input
                id="cn-mfg"
                type="date"
                value={manufacturedAt}
                onChange={(e) => setManufacturedAt(e.target.value)}
              />
            </FormField>
            <FormField label="Expires" htmlFor="cn-exp" hint="Optional">
              <Input
                id="cn-exp"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </FormField>
          </div>
        )}

        {/*
          Always rendered, empty or not. Hidden until the first row went
          in, the seller had no way to know a list existed — they filled
          the fields, saw nothing appear anywhere, and reasonably assumed
          typing them was the whole job. The header IS the instruction.
        */}
        <div className="mt-3">
          <Table>
            <THead>
              <Tr>
                <Th>Product</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Unit cost</Th>
                <Th align="right" />
              </Tr>
            </THead>
            <TBody>
              {lines.map((l, i) => (
                <Tr key={`${l.variantId}-${i}`}>
                  <Td>
                    <span className="flex items-center gap-2.5">
                      {l.imageUrl !== null ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={l.imageUrl}
                          alt=""
                          className="border-border h-8 w-8 shrink-0 rounded-[4px] border object-cover"
                        />
                      ) : (
                        <span
                          className="border-border bg-surface-raised h-8 w-8 shrink-0 rounded-[4px] border"
                          aria-hidden
                        />
                      )}
                      <span className="flex min-w-0 flex-col">
                        {/* Same reason as the picker: the variant label
                            is the tail of the string and the thing that
                            distinguishes one staged row from the next. */}
                        <span className="text-text-body text-sm leading-snug">{l.label}</span>
                        <span className="text-text-muted font-mono text-xs">{l.skuCode}</span>
                      </span>
                    </span>
                  </Td>
                  <Td align="right">
                    <Num value={l.expectedQty} />
                  </Td>
                  <Td align="right">{l.unitCostInr === undefined ? '—' : l.unitCostInr}</Td>
                  <Td align="right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  </Td>
                </Tr>
              ))}
              {lines.length === 0 && (
                <Tr>
                  <Td colSpan={4}>
                    <span className="text-text-muted text-xs">
                      Nothing added yet. Pick a product above, give it a quantity, then press Add.
                    </span>
                  </Td>
                </Tr>
              )}
            </TBody>
          </Table>
        </div>
      </Section>

      <Section>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label="Expected arrival"
            htmlFor="cn-eta"
            hint="Optional. A rough date beats none."
          >
            <Input
              id="cn-eta"
              type="date"
              value={expectedArrivalAt}
              onChange={(e) => setExpectedArrivalAt(e.target.value)}
            />
          </FormField>
          <FormField label="Your reference" htmlFor="cn-ref" hint="Optional.">
            <Input
              id="cn-ref"
              value={sellerReference}
              onChange={(e) => setSellerReference(e.target.value)}
            />
          </FormField>
        </div>
      </Section>

      {create.error !== null && <ErrorNote message={serverVerdict(create.error)} />}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Cancel
        </Button>
        <Button
          size="md"
          disabled={pendingLines.length === 0 || create.isPending}
          onClick={() =>
            create.mutate(
              {
                route,
                // Mapped down to the wire shape here — the extra fields
                // exist so the seller can read the list, not for the API.
                lines: pendingLines.map((l) => ({
                  variantId: l.variantId,
                  expectedQty: l.expectedQty,
                  ...(l.unitCostInr === undefined ? {} : { unitCostInr: l.unitCostInr }),
                  ...(l.manufacturedAt === undefined ? {} : { manufacturedAt: l.manufacturedAt }),
                  ...(l.expiresAt === undefined ? {} : { expiresAt: l.expiresAt }),
                })),
                ...(expectedArrivalAt === ''
                  ? {}
                  : { expectedArrivalAt: new Date(expectedArrivalAt).toISOString() }),
                ...(sellerReference.trim() === ''
                  ? {}
                  : { sellerReference: sellerReference.trim() }),
              },
              { onSuccess: close },
            )
          }
        >
          {create.isPending
            ? 'Announcing…'
            : `Announce ${pendingLines.length} product${pendingLines.length === 1 ? '' : 's'}`}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
