'use client';

import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import {
  Info,
  MapPin,
  PackageOpen,
  PackagePlus,
  Plane,
  Plus,
  RotateCcw,
  Scale,
  Ship,
  Trash2,
  Truck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ConsignmentRoute, ConsignmentStatus } from '@skydrop/db';
import { Num } from '@skydrop/ui/components';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { ChoiceCards } from '@skydrop/ui/app/choice-cards';
import { Table, TBody, Td, Th, THead, Tr, TableEmpty } from '@skydrop/ui/app/data-table';
import { DateField } from '@skydrop/ui/app/date-field';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { NumberStepper } from '@skydrop/ui/app/number-stepper';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Pagination } from '@skydrop/ui/app/pagination';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Stepper } from '@skydrop/ui/app/stepper';
import { Tabs } from '@skydrop/ui/app/tabs';
import { TextField } from '@skydrop/ui/app/text-field';
import {
  AreaPage,
  AreaSection,
  Dash,
  FieldGrid,
  InlineError,
  KpiGrid,
  MetaFact,
  MetaFacts,
  Note,
  Panel,
  PanelPad,
  mutationPhase,
  rawCount,
} from '@/app/(authed)/inventory/_components/stock-ui';
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
  const landed = items.filter((c) => c.status === ConsignmentStatus.COMPLETED);
  const filtered = status !== '' || route !== '';

  const resetFilters = (): void => {
    setStatus('');
    setRoute('');
    setPage(1);
  };

  return (
    <AreaPage>
      <PageHeader
        breadcrumbs={[{ label: 'Seller console' }, { label: 'Stock' }, { label: 'Add stock' }]}
        Link={Link}
        title="Add stock"
        subtitle="Consignments on their way to the Indian warehouse — where each one is now, and what was counted when it got there."
        meta={
          list.data === undefined ? undefined : (
            <MetaFacts>
              <MetaFact tone="accent">
                {total} {total === 1 ? 'consignment' : 'consignments'}
              </MetaFact>
              {moving.length > 0 && <MetaFact dot>{moving.length} still travelling</MetaFact>}
              {varied.length > 0 && (
                <MetaFact tone="warn">{varied.length} counted differently</MetaFact>
              )}
            </MetaFacts>
          )
        }
        action={
          canManage ? (
            // PRIMARY — the one action this page exists for.
            <Button
              variant="primary"
              size="md"
              icon={<PackagePlus size={16} />}
              onClick={() => setAnnouncing(true)}
            >
              Announce a consignment
            </Button>
          ) : undefined
        }
      />

      {/*
        Three tiles, and every figure but one is summed from the page
        BELOW them — there is no consignments-summary endpoint, and the
        list endpoint answers one page at a time. `total` is the
        server's, and it is the only one presented as a whole-account
        figure; the rest say "on this page" in their own hint. A count
        of rows dressed as a fleet statistic is the reading a seller
        would plan a shipment around.
      */}
      {list.data === undefined ? (
        <KpiGrid>
          <KpiCard label="Still travelling" icon={<Plane size={14} />} figure={<Dash />} />
          <KpiCard label="Landed and counted" icon={<PackageOpen size={14} />} figure={<Dash />} />
          <KpiCard label="Counted differently" icon={<Scale size={14} />} figure={<Dash />} />
        </KpiGrid>
      ) : (
        <KpiGrid>
          <KpiCard
            label="Still travelling"
            icon={<Plane size={14} />}
            value={moving.length}
            format={rawCount}
            unit="on this page"
            tone="info"
            hint="Announced, in Dhaka, or in the air."
          />
          <KpiCard
            label="Landed and counted"
            icon={<PackageOpen size={14} />}
            value={landed.length}
            format={rawCount}
            unit="on this page"
            tone="neutral"
            hint="Fully received in India. Their stock is on the shelf."
          />
          <KpiCard
            label="Counted differently"
            icon={<Scale size={14} />}
            value={varied.length}
            format={rawCount}
            unit="on this page"
            tone={varied.length > 0 ? 'pending' : 'neutral'}
            // CNS-3: a variance is a NUMBER, never a blocking state.
            // Saying so on the tile is what stops somebody waiting for a
            // release that is never coming.
            hint={
              varied.length > 0
                ? 'Nothing is blocked by it — your stock is what was counted.'
                : 'Every count so far matched what was declared.'
            }
          />
        </KpiGrid>
      )}

      <AreaSection
        title="Consignment register"
        note={
          list.data === undefined
            ? undefined
            : `${total} ${total === 1 ? 'consignment' : 'consignments'}${filtered ? ' matching' : ''}`
        }
        action={
          filtered ? (
            <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={resetFilters}>
              Reset
            </Button>
          ) : undefined
        }
      >
        <Panel flush>
          {/* Two tab rows — where it is, and which way it came. Both are
              short vocabularies worth seeing at once, directly above the
              register they filter. Their labels are plain sentence-case
              words now, not mono capitals. */}
          <div className="inv-pad inv-stack inv-stack--tight">
            <div className="inv-filter-row">
              <span className="inv-filter-row__label" id="cn-where">
                Where
              </span>
              <Tabs
                label="Where"
                size="sm"
                value={status === '' ? 'ANY' : status}
                onChange={(id) => {
                  setStatus(id === 'ANY' ? '' : (id as ConsignmentStatus));
                  setPage(1);
                }}
                items={[
                  { id: 'ANY', label: 'Anywhere' },
                  ...Object.values(ConsignmentStatus).map((s) => ({
                    id: s,
                    label: statusWords(s),
                  })),
                ]}
              />
            </div>
            <div className="inv-filter-row">
              <span className="inv-filter-row__label" id="cn-route">
                Route
              </span>
              <Tabs
                label="Route"
                size="sm"
                value={route === '' ? 'ANY' : route}
                onChange={(id) => {
                  setRoute(id === 'ANY' ? '' : (id as ConsignmentRoute));
                  setPage(1);
                }}
                items={[
                  { id: 'ANY', label: 'Either route' },
                  ...Object.values(ConsignmentRoute).map((r) => ({
                    id: r,
                    label: routeWords(r).title,
                  })),
                ]}
              />
            </div>
          </div>

          {list.isLoading ? (
            <PanelPad>
              <SkeletonRows rows={5} cols={6} />
            </PanelPad>
          ) : list.isError ? (
            <PanelPad>
              <InlineError message={serverVerdict(list.error)} retry={() => void list.refetch()} />
            </PanelPad>
          ) : items.length === 0 ? (
            <PanelPad>
              <EmptyState
                title={filtered ? 'Nothing matches that' : 'No stock announced yet'}
                description={
                  filtered
                    ? 'Try another place or route, or reset the filters.'
                    : 'Announce a consignment before it ships so receiving knows to expect it — and so you can follow it.'
                }
                action={
                  filtered ? (
                    <Button variant="secondary" size="md" onClick={resetFilters}>
                      Reset filters
                    </Button>
                  ) : canManage ? (
                    <Button
                      variant="primary"
                      size="md"
                      icon={<PackagePlus size={16} />}
                      onClick={() => setAnnouncing(true)}
                    >
                      Announce a consignment
                    </Button>
                  ) : undefined
                }
                bare
              />
            </PanelPad>
          ) : (
            <>
              <Table caption="Consignment register">
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
                        <Link href={`/inbound/${c.id}`} className="inv-link sk-ident">
                          {c.consignmentNumber}
                        </Link>
                      </Td>
                      <Td>{routeWords(c.route).title}</Td>
                      <Td align="right">
                        <Num value={productCount(c)} />
                      </Td>
                      <Td>
                        <span className="inv-muted">{c.sellerReference ?? <Dash />}</span>
                      </Td>
                      <Td>
                        <span className="sk-figure inv-muted">
                          {shortDate(c.expectedArrivalAt)}
                        </span>
                      </Td>
                      <Td>
                        <StatusChip
                          kind={consignmentStatusKind(c.status)}
                          label={statusWords(c.status)}
                          size="sm"
                        />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <PanelPad>
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={total}
                  onPageChange={setPage}
                  label="Consignment pages"
                />
              </PanelPad>
            </>
          )}
        </Panel>
        <Note>
          Open a consignment to see its timeline, and what each warehouse counted against what you
          declared.
        </Note>
      </AreaSection>

      <AnnounceConsignment open={announcing} onClose={() => setAnnouncing(false)} />
    </AreaPage>
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

  // The three steps of announcing, as a progress header over the SAME
  // single form: the route always has an answer (it defaults), the
  // contents step is done once a product is listed, and the last step is
  // the arrival date, reference and the Announce press. Nothing is hidden
  // or skipped — it only shows where the form stands.
  const step = pendingLines.length === 0 ? 1 : 2;

  function announce(): void {
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
        ...(sellerReference.trim() === '' ? {} : { sellerReference: sellerReference.trim() }),
      },
      { onSuccess: close },
    );
  }

  const announceLabel = `Announce ${pendingLines.length} product${pendingLines.length === 1 ? '' : 's'}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      icon={<Ship size={18} />}
      title="Announce a consignment"
      description="Say where you are sending it and what is in it, so receiving knows what to count against."
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={close}>
            Cancel
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            icon={<Truck size={16} />}
            labels={{ idle: announceLabel, busy: 'Announcing…' }}
            state={mutationPhase(create)}
            disabled={pendingLines.length === 0 || create.isPending}
            onClick={announce}
          />
        </DialogFooter>
      }
    >
      <div className="inv-stack">
        <Stepper
          mode="wizard"
          label="Announcing a consignment"
          current={step}
          navigable="none"
          steps={[
            { id: 'cn-step-route', label: 'Route', icon: <MapPin size={14} /> },
            { id: 'cn-step-lines', label: 'Contents', icon: <PackageOpen size={14} /> },
            { id: 'cn-step-send', label: 'Arrival and reference', icon: <Truck size={14} /> },
          ]}
        />

        <section className="inv-stack inv-stack--tight" aria-labelledby="cn-route-h">
          <SectionHeading
            as="h3"
            id="cn-route-h"
            title="Where are you sending it?"
            // The full explanation of each route used to sit inside the
            // two choices, which made them tall enough to be most of the
            // modal — and a seller picking the same route for the tenth
            // time read none of it. It moved behind this toggle: the
            // choice carries enough to decide, the paragraph is one click
            // away, and neither is lost.
            action={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<Info size={16} />}
                onClick={() => setRouteInfo((v) => !v)}
                aria-expanded={routeInfo}
                aria-label={routeInfo ? 'Hide what the routes mean' : 'What do the routes mean?'}
              />
            }
          />
          <ChoiceCards
            label="Route"
            hideLegend
            name="cn-route-choice"
            value={route}
            onChange={(v) => setRoute(v as ConsignmentRoute)}
            options={Object.values(ConsignmentRoute).map((r) => ({
              value: r,
              title: routeWords(r).title,
              description: routeWords(r).hint,
              icon: r === ConsignmentRoute.DIRECT_IN ? <Truck size={16} /> : <Plane size={16} />,
            }))}
          />
          {routeInfo && (
            <dl className="inv-route-info">
              {Object.values(ConsignmentRoute).map((r) => (
                <div key={r}>
                  <dt>{routeWords(r).title}: </dt>
                  <dd>{routeWords(r).blurb}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className="inv-stack inv-stack--tight" aria-labelledby="cn-lines-h">
          <SectionHeading as="h3" id="cn-lines-h" title="What is in it?" />
          <Note>
            At least one product. Unit cost is optional but makes landed cost and margin accurate.
          </Note>
          {/*
            Four columns, with the button in the last one. It belongs to
            the row it adds — parked on a line of its own underneath, it
            read as a second opinion on the whole form and sat close enough
            to Announce to be mistaken for it.
          */}
          <div className="inv-line-grid">
            <VariantPicker
              id="cn-variant"
              fieldLabel="Item"
              value={picked?.id ?? ''}
              label={variantLabel}
              onPick={(hit, shown) => {
                setPicked(hit);
                setVariantLabel(shown);
              }}
            />
            <NumberStepper
              label="Quantity"
              id="cn-qty"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <TextField
              label="Unit cost (₹)"
              id="cn-cost"
              hint="Optional"
              type="number"
              min={0}
              step="0.01"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
            {/*
              Always PRIMARY, never dimmed to secondary while incomplete.
              The disabled state already reads as not-yet; switching
              colour as well made it recede exactly when somebody is
              looking for what to press next.
            */}
            <div className="inv-line-grid__add">
              <Button
                variant="primary"
                size="lg"
                icon={<Plus size={16} />}
                disabled={!lineReady}
                onClick={addLine}
                aria-label="Add this product to the consignment"
              >
                Add
              </Button>
            </div>
          </div>

          <Checkbox
            label="Has manufacture / expiry dates"
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
          />
          {hasDates && (
            <FieldGrid columns={2}>
              <DateField
                label="Manufactured"
                id="cn-mfg"
                hint="Optional"
                value={manufacturedAt}
                onChange={(e) => setManufacturedAt(e.target.value)}
              />
              <DateField
                label="Expires"
                id="cn-exp"
                hint="Optional"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </FieldGrid>
          )}

          {/*
            Always rendered, empty or not. Hidden until the first row went
            in, the seller had no way to know a list existed — they filled
            the fields, saw nothing appear anywhere, and reasonably assumed
            typing them was the whole job. The header IS the instruction.
          */}
          <Table caption="Products in this consignment">
            <THead>
              <Tr>
                <Th>Product</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Unit cost</Th>
                <Th align="right" aria-label="Remove" />
              </Tr>
            </THead>
            <TBody>
              {lines.map((l, i) => (
                <Tr key={`${l.variantId}-${i}`}>
                  <Td>
                    <span className="inv-product">
                      {l.imageUrl !== null ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.imageUrl} alt="" className="prd-thumb" />
                      ) : (
                        <span className="prd-thumb" aria-hidden />
                      )}
                      <span className="inv-combo__text">
                        {/* Same reason as the picker: the variant label
                            is the tail of the string and the thing that
                            distinguishes one staged row from the next. */}
                        <span className="inv-combo__name">{l.label}</span>
                        <span className="sk-ident inv-muted">{l.skuCode}</span>
                      </span>
                    </span>
                  </Td>
                  <Td align="right">
                    <Num value={l.expectedQty} />
                  </Td>
                  <Td align="right">
                    <span className="sk-figure">
                      {l.unitCostInr === undefined ? '—' : l.unitCostInr}
                    </span>
                  </Td>
                  <Td align="right">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  </Td>
                </Tr>
              ))}
              {lines.length === 0 && (
                <TableEmpty colSpan={4}>
                  <span className="inv-muted">
                    Nothing added yet. Pick a product above, give it a quantity, then press Add.
                  </span>
                </TableEmpty>
              )}
            </TBody>
          </Table>
        </section>

        <FieldGrid columns={2}>
          <DateField
            label="Expected arrival"
            id="cn-eta"
            hint="Optional. A rough date beats none."
            value={expectedArrivalAt}
            onChange={(e) => setExpectedArrivalAt(e.target.value)}
          />
          <TextField
            label="Your reference"
            id="cn-ref"
            hint="Optional."
            value={sellerReference}
            onChange={(e) => setSellerReference(e.target.value)}
          />
        </FieldGrid>

        {create.error !== null && <InlineError message={serverVerdict(create.error)} />}
      </div>
    </Dialog>
  );
}
