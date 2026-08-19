'use client';

import { useMemo, useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Section,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import {
  useBulkBinTransfer,
  useMoveWholeBin,
  useWarehouseBins,
  useWarehouses,
  type WarehouseBin,
} from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { NON_PICKABLE_BIN_TYPES as NON_PICKABLE } from '@/lib/bin-policy';

/**
 * Re-shelving.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * The bins screen above lets you BUILD a layout. Nothing let you change
 * one. Both endpoints have been in the API since the bin-ops module
 * landed and neither had a caller, so re-organising a warehouse floor —
 * the ordinary act of "this rack is being emptied, everything moves to
 * B-02" — was impossible from any interface. The only alternative was
 * the inter-warehouse transfer form, one variant+batch at a time, which
 * is a considered correction rather than physical work.
 *
 * ── WHY TWO SHAPES, NOT ONE ──────────────────────────────────────────
 * On a floor the unit of work is either "this whole shelf goes over
 * there" — you pick the box up and carry it, and nobody enumerates what
 * was inside — or "here is the list off the re-organisation sheet". The
 * server expands the first into the second and runs both through the
 * same transactional mover, so they cannot behave differently.
 *
 * ── WHAT A MOVE IS NOT ───────────────────────────────────────────────
 * The batch never changes. A move answers WHERE, not WHAT: re-batching
 * would reorder FEFO picking and sever the goods-receipt link inbound
 * freight is attributed through. That is why the bulk form asks for a
 * batch id per line and does not offer to pick one.
 *
 * ── NOT BUILT HERE, DELIBERATELY ─────────────────────────────────────
 * Collapse (merge every bin into FLOOR) is a different act with a
 * different permission, a two-step emailed confirmation code and a
 * snapshot to restore from. It destroys the record of where everything
 * was and is meant to be hard to reach; putting it beside a routine
 * re-shelving button is exactly how it gets clicked by accident.
 */

interface DraftLine {
  readonly key: number;
  sellerId: string;
  variantId: string;
  batchId: string;
  qty: string;
  sourceBinId: string;
  destBinId: string;
}

function emptyLine(key: number): DraftLine {
  return { key, sellerId: '', variantId: '', batchId: '', qty: '', sourceBinId: '', destBinId: '' };
}

function binLabel(b: WarehouseBin): string {
  return NON_PICKABLE.has(b.type) ? `${b.code} — ${b.type}, not pickable` : b.code;
}

export function BinOpsPanel({
  warehouseId,
}: {
  /** Omit it and the panel resolves the warehouse itself, so it can be
   *  mounted standalone on the page as well as inside a screen that has
   *  already chosen one. */
  readonly warehouseId?: string;
}): ReactElement | null {
  // COSMETIC (FE-2). The page is gated on warehouse.view; both endpoints
  // demand warehouse.manage. Without this, anyone who can read the floor
  // plan is offered two buttons the server will refuse.
  const mayManage = usePermission('warehouse.manage');

  const toast = useToast();
  const warehouses = useWarehouses();
  const [pickedWarehouse, setPickedWarehouse] = useState('');
  // Land on the first warehouse rather than making the operator choose
  // one when, as today, there is exactly one.
  const activeId = warehouseId ?? pickedWarehouse;
  const resolvedId = activeId || (warehouses.data?.[0]?.id ?? '');

  const bins = useWarehouseBins(resolvedId);
  const moveBin = useMoveWholeBin(resolvedId);
  const bulk = useBulkBinTransfer(resolvedId);

  const [error, setError] = useState<string | null>(null);
  const [sourceBinId, setSourceBinId] = useState('');
  const [destBinId, setDestBinId] = useState('');
  const [confirmMove, setConfirmMove] = useState(false);

  const [nextKey, setNextKey] = useState(1);
  const [lines, setLines] = useState<readonly DraftLine[]>([emptyLine(0)]);

  const binOptions = bins.data ?? [];
  const byId = useMemo(() => new Map(binOptions.map((b) => [b.id, b])), [binOptions]);

  const sameBin = sourceBinId !== '' && sourceBinId === destBinId;
  const canMove = sourceBinId !== '' && destBinId !== '' && !sameBin;

  function editLine(key: number, patch: Partial<DraftLine>): void {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setError(null);
  }

  function addLine(): void {
    setLines((ls) => [...ls, emptyLine(nextKey)]);
    setNextKey((k) => k + 1);
  }

  function removeLine(key: number): void {
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((l) => l.key !== key)));
  }

  // Mirrors the server's own floors — ArrayMinSize(1), Min(1) on qty, and
  // "a line moves stock from a bin to itself" — so the operator is told
  // before submitting rather than after. The server still decides.
  const lineComplete = (l: DraftLine): boolean =>
    l.sellerId.trim() !== '' &&
    l.variantId.trim() !== '' &&
    l.batchId.trim() !== '' &&
    Number.isInteger(Number(l.qty)) &&
    Number(l.qty) >= 1 &&
    l.sourceBinId !== '' &&
    l.destBinId !== '' &&
    l.sourceBinId !== l.destBinId;

  const bulkReady = lines.length >= 1 && lines.every(lineComplete);
  const bulkUnits = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);

  async function onMoveWholeBin(): Promise<void> {
    setError(null);
    try {
      const r = await moveBin.mutateAsync({ sourceBinId, destBinId });
      setConfirmMove(false);
      setSourceBinId('');
      setDestBinId('');
      // The counts come from the SERVER. It expanded the bin's contents;
      // we never knew what was in there, and guessing would report a
      // number nobody moved.
      toast.success(
        `Moved ${r.unitsMoved} unit(s) across ${r.linesMoved} line(s) into ${
          byId.get(destBinId)?.code ?? 'the destination bin'
        }.`,
      );
    } catch (err) {
      setConfirmMove(false);
      setError(serverVerdict(err));
    }
  }

  async function onBulkTransfer(): Promise<void> {
    setError(null);
    try {
      const r = await bulk.mutateAsync(
        lines.map((l) => ({
          sellerId: l.sellerId.trim(),
          variantId: l.variantId.trim(),
          batchId: l.batchId.trim(),
          // A number, not the input's string: the DTO is @IsInt and the
          // API runs forbidNonWhitelisted with implicit conversion off
          // for anything it did not declare a @Type for.
          qty: Number(l.qty),
          sourceBinId: l.sourceBinId,
          destBinId: l.destBinId,
        })),
      );
      setLines([emptyLine(nextKey)]);
      setNextKey((k) => k + 1);
      toast.success(`Re-shelved ${r.unitsMoved} unit(s) across ${r.linesMoved} line(s).`);
    } catch (err) {
      // Nothing was applied — the whole submission is one transaction, so
      // the list on screen is still exactly what needs to happen.
      setError(serverVerdict(err));
    }
  }

  if (!mayManage) return null;

  return (
    <Section
      title="Move stock between bins"
      subtitle="Re-shelving. The batch never changes — a move answers where something is, not what it is."
    >
      {warehouseId === undefined && (warehouses.data?.length ?? 0) > 1 && (
        <div className="mb-3 max-w-sm">
          <FormField label="Warehouse" htmlFor="binops-wh">
            <Select
              id="binops-wh"
              value={resolvedId}
              onChange={(e) => {
                setPickedWarehouse(e.target.value);
                setSourceBinId('');
                setDestBinId('');
                setError(null);
              }}
            >
              {(warehouses.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      )}

      {error !== null && <ErrorNote message={error} />}

      {/* ── Whole bin ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Empty one bin into another"
          subtitle="Everything currently standing in the source bin, in one transaction. You do not list the contents — the server reads them."
        />
        <CardBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="From" htmlFor="binops-src">
              <Select
                id="binops-src"
                value={sourceBinId}
                onChange={(e) => {
                  setSourceBinId(e.target.value);
                  setError(null);
                }}
              >
                <option value="">Choose…</option>
                {binOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {binLabel(b)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="To" htmlFor="binops-dst">
              <Select
                id="binops-dst"
                value={destBinId}
                onChange={(e) => {
                  setDestBinId(e.target.value);
                  setError(null);
                }}
              >
                <option value="">Choose…</option>
                {binOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {binLabel(b)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <div className="text-sm" aria-live="polite">
            {sameBin ? (
              <span className="text-[var(--status-pending-fg)]">
                Source and destination are the same bin — nothing to move.
              </span>
            ) : destBinId !== '' && NON_PICKABLE.has(byId.get(destBinId)?.type ?? '') ? (
              <span className="text-[var(--status-rto-fg)]">
                {byId.get(destBinId)?.code} is not pickable. Stock moved there stays counted but
                stops being sellable, and orders will not allocate against it.
              </span>
            ) : (
              <span className="text-text-faint">
                The source bin&rsquo;s FLOOR pile counts too — this is how you shelve stock that was
                received before tracking was switched on.
              </span>
            )}
          </div>

          <Button
            variant="primary"
            size="md"
            disabled={!canMove || moveBin.isPending}
            onClick={() => setConfirmMove(true)}
          >
            {moveBin.isPending ? 'Moving…' : 'Move the whole bin'}
          </Button>
        </CardBody>
      </Card>

      {/* ── Line list ─────────────────────────────────────────────── */}
      <Card className="mt-4">
        <CardHeader
          title="Apply a list of moves"
          subtitle="All of it commits or none of it does. A half-applied re-shelving is worse than none, because nobody can tell which half went through."
        />
        <CardBody className="space-y-3 p-0">
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>Seller id</Th>
                  <Th>Variant id</Th>
                  <Th>Batch id</Th>
                  <Th>Qty</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th> </Th>
                </Tr>
              </THead>
              <TBody>
                {lines.map((l) => (
                  <Tr key={l.key}>
                    <Td>
                      <Input
                        value={l.sellerId}
                        aria-label="Seller id"
                        onChange={(e) => editLine(l.key, { sellerId: e.target.value })}
                      />
                    </Td>
                    <Td>
                      <Input
                        value={l.variantId}
                        aria-label="Variant id"
                        onChange={(e) => editLine(l.key, { variantId: e.target.value })}
                      />
                    </Td>
                    <Td>
                      <Input
                        value={l.batchId}
                        aria-label="Batch id"
                        onChange={(e) => editLine(l.key, { batchId: e.target.value })}
                      />
                    </Td>
                    <Td>
                      <Input
                        value={l.qty}
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        aria-label="Quantity"
                        onChange={(e) => editLine(l.key, { qty: e.target.value })}
                      />
                    </Td>
                    <Td>
                      <Select
                        value={l.sourceBinId}
                        aria-label="From bin"
                        onChange={(e) => editLine(l.key, { sourceBinId: e.target.value })}
                      >
                        <option value="">Choose…</option>
                        {binOptions.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.code}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td>
                      <Select
                        value={l.destBinId}
                        aria-label="To bin"
                        onChange={(e) => editLine(l.key, { destBinId: e.target.value })}
                      >
                        <option value="">Choose…</option>
                        {binOptions.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.code}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={lines.length === 1}
                        onClick={() => removeLine(l.key)}
                      >
                        Remove
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
            <Button variant="ghost" size="md" onClick={addLine}>
              Add a line
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={!bulkReady || bulk.isPending}
              onClick={() => void onBulkTransfer()}
            >
              {bulk.isPending ? 'Applying…' : `Apply ${lines.length} line(s)`}
            </Button>
            <span className="text-text-faint text-xs">
              {bulkReady
                ? `${bulkUnits} unit(s) will move.`
                : 'Every line needs a seller, variant, batch, a whole quantity of at least one, and two different bins.'}
            </span>
          </div>
        </CardBody>
      </Card>

      <Modal
        open={confirmMove}
        onOpenChange={(next) => {
          if (!next) setConfirmMove(false);
        }}
        title={`Move everything in ${byId.get(sourceBinId)?.code ?? 'this bin'}?`}
      >
        <p className="text-text-muted mb-3 text-sm">
          Every unit standing in{' '}
          <span className="font-mono">{byId.get(sourceBinId)?.code ?? '—'}</span> is recorded as
          moved to <span className="font-mono">{byId.get(destBinId)?.code ?? '—'}</span>. Do this
          once the goods have physically been carried across — the record follows the shelf, and a
          picker sent to the new bin needs to find them there.
        </p>
        <p className="text-text-faint mb-3 text-sm">
          It is not destructive: batches, quantities and expiry are untouched, and moving it back is
          the same action in reverse.
        </p>
        <ModalFooter>
          <Button variant="secondary" size="md" onClick={() => setConfirmMove(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={moveBin.isPending}
            onClick={() => void onMoveWholeBin()}
          >
            {moveBin.isPending ? 'Moving…' : 'Move it'}
          </Button>
        </ModalFooter>
      </Modal>
    </Section>
  );
}
