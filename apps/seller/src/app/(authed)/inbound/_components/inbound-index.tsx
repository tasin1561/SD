'use client';

import { useState, type ReactElement } from 'react';
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
  Stat,
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
import {
  useCancelGoodsReceipt,
  useCreateGoodsReceipt,
  useGoodsReceipts,
  type GoodsReceiptView,
} from '@/lib/account-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { EditReceiptPanel } from './edit-receipt-panel';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';
import type { SellerVariantSearchHit } from '@skydrop/api-client';
import { VariantPicker } from './variant-picker';

const PAGE_SIZE = 25;

/**
 * Inbound consignments — stock you are sending to the Indian warehouse.
 *
 * You announce one before it travels; the warehouse marks it received
 * and counts it. That announcement is not paperwork: it is what lets
 * receiving know a box is expected and whose it is, and an unannounced
 * box is one nobody can put away.
 *
 * The status to watch is DISCREPANCY — it means what arrived and what
 * you said differ, and until someone resolves it the counted stock is
 * not the stock you think you have.
 */
/**
 * A consignment row as the SELLER sees it, not as the API takes it.
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
  const canManage = can(useSellerIdentity(), 'inbound.manage');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [announcing, setAnnouncing] = useState(false);
  const [cancelling, setCancelling] = useState<GoodsReceiptView | null>(null);
  const [editing, setEditing] = useState<GoodsReceiptView | null>(null);

  const list = useGoodsReceipts({
    ...(status === '' ? {} : { status }),
    page,
    pageSize: PAGE_SIZE,
  });
  const cancel = useCancelGoodsReceipt();

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const inFlight = items.filter((r) => r.status === 'PENDING' || r.status === 'ARRIVING');
  const discrepant = items.filter((r) => r.hasDiscrepancies);

  return (
    <div>
      <PageHeader
        title="Add stock"
        subtitle="Consignments you are sending to the Indian warehouse, and what happened when they arrived."
        action={
          canManage ? (
            <Button onClick={() => setAnnouncing(true)}>Announce a consignment</Button>
          ) : undefined
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Shown" value={<Num value={items.length} />} />
        <Stat label="On the way" value={<Num value={inFlight.length} />} />
        <Stat
          label="With a discrepancy"
          hint="What arrived differs from what was announced"
          value={<Num value={discrepant.length} />}
          tone={discrepant.length > 0 ? 'warn' : 'neutral'}
        />
      </div>

      <Toolbar>
        <label className="text-text-muted text-xs" htmlFor="gr-status">
          Status
        </label>
        <Select
          id="gr-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-56"
        >
          <option value="">All statuses</option>
          {['PENDING', 'ARRIVING', 'COMPLETED', 'DISCREPANCY', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
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
            description="Announce a consignment before it ships so receiving knows to expect it."
            action={
              canManage ? (
                <Button onClick={() => setAnnouncing(true)}>Announce a consignment</Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <Tr>
                  <Th>Receipt</Th>
                  <Th>Your reference</Th>
                  <Th>Expected</Th>
                  <Th align="right">SKUs</Th>
                  <Th>Received</Th>
                  <Th>Status</Th>
                  <Th align="right" />
                </Tr>
              </THead>
              <TBody>
                {items.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <span className="font-mono text-xs">{r.receiptNumber}</span>
                    </Td>
                    <Td>{r.sellerReference ?? '—'}</Td>
                    <Td>
                      {r.expectedArrivalAt === null
                        ? '—'
                        : new Date(r.expectedArrivalAt).toLocaleDateString('en-IN')}
                    </Td>
                    <Td align="right">
                      <Num value={r.lines.length} />
                    </Td>
                    <Td>
                      {r.receivedAt === null
                        ? '—'
                        : new Date(r.receivedAt).toLocaleDateString('en-IN')}
                    </Td>
                    <Td>
                      <StatusBadge kind={receiptKind(r.status)} label={r.status.toLowerCase()} />
                    </Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Narrower than Cancel on purpose: `update` refuses
                            ARRIVING, `cancel` allows it. */}
                        {canManage && r.status === 'PENDING' && (
                          <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                            Correct
                          </Button>
                        )}
                        {canManage && (r.status === 'PENDING' || r.status === 'ARRIVING') && (
                          <Button variant="ghost" size="sm" onClick={() => setCancelling(r)}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <TablePaginator page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </Card>

      {discrepant.length > 0 && (
        <p className="mt-3 text-text-muted text-sm">
          A consignment marked <strong>discrepancy</strong> means the warehouse counted something
          different from what you announced. Raise a ticket if the difference is not yours.
        </p>
      )}

      <AnnounceConsignment open={announcing} onClose={() => setAnnouncing(false)} />
      <EditReceiptPanel receipt={editing} onClose={() => setEditing(null)} />

      <Modal
        open={cancelling !== null}
        onOpenChange={(next) => {
          if (!next) setCancelling(null);
        }}
        title="Cancel this consignment?"
        description="Only do this if the stock is genuinely not coming. Receiving will stop expecting it."
      >
        {cancel.error !== null && <ErrorNote message={serverVerdict(cancel.error)} />}
        <ModalFooter>
          <Button variant="ghost" size="md" onClick={() => setCancelling(null)}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            size="md"
            disabled={cancel.isPending}
            onClick={() => {
              if (cancelling !== null) {
                cancel.mutate({ id: cancelling.id }, { onSuccess: () => setCancelling(null) });
              }
            }}
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel consignment'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function receiptKind(
  status: string,
): 'pending' | 'in-transit' | 'delivered' | 'failed' | 'cancelled' {
  switch (status) {
    case 'PENDING':
      return 'pending';
    case 'ARRIVING':
      return 'in-transit';
    case 'COMPLETED':
      return 'delivered';
    case 'DISCREPANCY':
      return 'failed';
    default:
      return 'cancelled';
  }
}

/**
 * Declaring a consignment means listing what is in it.
 *
 * The API requires at least one line, and that is the right shape: a
 * receipt with no contents tells receiving a box is coming but not what
 * to count, which is the same as not declaring it. The warehouse is
 * deliberately NOT asked for — sellers do not choose it, and there is no
 * seller-visible endpoint that lists warehouses; the server puts the
 * consignment where stock for this seller goes.
 */
function AnnounceConsignment({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactElement {
  const create = useCreateGoodsReceipt();
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
  const pendingLines = [...lines, ...(draftLine() === null ? [] : [draftLine()!])];

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      title="Announce a consignment"
      description="List what is in the box so receiving knows what to count against."
    >
      {/* No section heading: "What is in it" and "When and what you call
          it" were labels for groups whose own fields already say what
          they are, and they made a short form read like a questionnaire. */}
      <Section>
        <p className="text-text-muted mb-3 text-xs">
          At least one product. Unit cost is optional but makes landed cost and margin accurate.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Item" htmlFor="gr-variant">
            <VariantPicker
              id="gr-variant"
              value={picked?.id ?? ''}
              label={variantLabel}
              onPick={(hit, shown) => {
                setPicked(hit);
                setVariantLabel(shown);
              }}
            />
          </FormField>
          <FormField label="Quantity" htmlFor="gr-qty">
            <Input
              id="gr-qty"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </FormField>
          <FormField label="Unit cost (₹)" htmlFor="gr-cost" hint="Optional">
            <Input
              id="gr-cost"
              type="number"
              min={0}
              step="0.01"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
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
          This product has manufacture and expiry dates
        </label>

        {hasDates && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <FormField label="Manufactured" htmlFor="gr-mfg" hint="Optional">
              <Input
                id="gr-mfg"
                type="date"
                value={manufacturedAt}
                onChange={(e) => setManufacturedAt(e.target.value)}
              />
            </FormField>
            <FormField label="Expires" htmlFor="gr-exp" hint="Optional">
              <Input
                id="gr-exp"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </FormField>
          </div>
        )}
        <Button variant="secondary" size="sm" disabled={!lineReady} onClick={addLine}>
          Add product
        </Button>

        {lines.length > 0 && (
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
                        <span className="text-text-body truncate text-sm">{l.label}</span>
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
            </TBody>
          </Table>
        )}
      </Section>

      <Section>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            label="Expected arrival"
            htmlFor="gr-eta"
            hint="Optional. A rough date beats none."
          >
            <Input
              id="gr-eta"
              type="date"
              value={expectedArrivalAt}
              onChange={(e) => setExpectedArrivalAt(e.target.value)}
            />
          </FormField>
          <FormField label="Your reference" htmlFor="gr-ref" hint="Optional.">
            <Input
              id="gr-ref"
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
            : `Announce ${lines.length} product${lines.length === 1 ? '' : 's'}`}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
