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
  type DeclareReceiptLine,
  type GoodsReceiptView,
} from '@/lib/account-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';

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
export function InboundIndex(): ReactElement {
  const canManage = can(useSellerIdentity(), 'inbound.manage');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [announcing, setAnnouncing] = useState(false);
  const [cancelling, setCancelling] = useState<GoodsReceiptView | null>(null);

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
        title="Inbound stock"
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
            title="Nothing inbound"
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
                      {r.expectedSkus === null ? '—' : <Num value={r.expectedSkus} />}
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
                      {canManage && (r.status === 'PENDING' || r.status === 'ARRIVING') && (
                        <Button variant="ghost" size="sm" onClick={() => setCancelling(r)}>
                          Cancel
                        </Button>
                      )}
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
  const [lines, setLines] = useState<DeclareReceiptLine[]>([]);
  const [variantId, setVariantId] = useState('');
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');

  function close(): void {
    setExpectedArrivalAt('');
    setSellerReference('');
    setLines([]);
    setVariantId('');
    setQty('');
    setUnitCost('');
    create.reset();
    onClose();
  }

  function addLine(): void {
    setLines((ls) => [
      ...ls,
      {
        variantId: variantId.trim(),
        expectedQty: Number(qty),
        ...(unitCost.trim() === '' ? {} : { unitCostInr: Number(unitCost) }),
      },
    ]);
    setVariantId('');
    setQty('');
    setUnitCost('');
  }

  const lineReady = variantId.trim() !== '' && Number(qty) > 0;

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
      <Section
        title="What is in it"
        subtitle="At least one line. Unit cost is optional but makes landed cost and margin accurate."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Variant id" htmlFor="gr-variant">
            <Input
              id="gr-variant"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              placeholder="From your catalog"
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
        <Button variant="secondary" size="sm" disabled={!lineReady} onClick={addLine}>
          Add line
        </Button>

        {lines.length > 0 && (
          <Table>
            <THead>
              <Tr>
                <Th>Variant</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Unit cost</Th>
                <Th align="right" />
              </Tr>
            </THead>
            <TBody>
              {lines.map((l, i) => (
                <Tr key={`${l.variantId}-${i}`}>
                  <Td>
                    <span className="font-mono text-xs">{l.variantId}</span>
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

      <Section title="When and what you call it">
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
          disabled={lines.length === 0 || create.isPending}
          onClick={() =>
            create.mutate(
              {
                lines,
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
            : `Announce ${lines.length} line${lines.length === 1 ? '' : 's'}`}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
