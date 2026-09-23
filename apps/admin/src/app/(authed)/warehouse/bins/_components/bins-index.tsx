'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { Num, useToast } from '@skydrop/ui/components';
import { Plus, Trash2 } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Table, TableEmpty, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TextField } from '@skydrop/ui/app/text-field';
import {
  useCreateBin,
  useCreateZone,
  useDeleteBin,
  useSetBinTracking,
  useWarehouseBins,
  useWarehouses,
  useWarehouseZones,
  type WarehouseBin,
} from '@/lib/api-hooks';
import Link from 'next/link';
import { useBinOverview } from '@/lib/bin-contents-hooks';
import { WarehouseFormPanel } from '../../_components/warehouse-form-panel';
import { BinContentsOverview } from './bin-contents-overview';
import { BinOpsPanel } from './bin-ops-panel';
import { serverVerdict } from '@/lib/server-verdict';
import {
  Actions,
  AreaPage,
  AreaSection,
  Code,
  FieldGrid,
  InlineError,
  Note,
  Panel,
  ToneText,
  mutationPhase,
} from '../../../inventory/_components/stock-kit';
import { NON_PICKABLE_BIN_TYPES as NON_PICKABLE } from '@/lib/bin-policy';

/**
 * Where things go.
 *
 * Two separate questions live on this screen and they are deliberately
 * not the same switch:
 *
 *   1. What locations EXIST in this building. Always editable — you have
 *      to be able to lay out shelving before you start using it.
 *   2. Whether the system ASKS for one. That is the per-warehouse
 *      toggle, and it moves no stock in either direction.
 *
 * Turning tracking on does not relocate what is already in FLOOR; that
 * drains as it is picked, or is moved deliberately. Turning it off does
 * not collapse the bins you built. Collapsing is a separate, destructive
 * act with its own confirmations, precisely so a misclick here cannot
 * cost a warehouse's worth of putaway work.
 */

/** Mirrors the server's composer (bin-code.ts) so the preview is honest. */
function composeCode(aisle: string, rack: string, shelf: string): string | null {
  const a = aisle.trim().toUpperCase();
  const r = rack.trim();
  const s = shelf.trim();
  if (!/^[A-Z]{1,2}$/.test(a)) return null;
  if (!/^\d{1,3}$/.test(r) || !/^\d{1,3}$/.test(s)) return null;
  return `${a}-${r.padStart(2, '0')}-${s.padStart(2, '0')}`;
}

const BIN_TYPES = [
  { value: 'STORAGE', label: 'Storage — the normal shelf' },
  { value: 'PICKING', label: 'Picking' },
  { value: 'RECEIVING', label: 'Receiving' },
  { value: 'PACKING', label: 'Packing' },
  { value: 'RTO_HOLD', label: 'Returns hold — not pickable' },
  // Returns kept aside damaged land here at finalise (WMS-8d); they leave
  // by an Inventory → Adjustments decrease from this bin.
  { value: 'DAMAGED', label: 'Damaged — not pickable (returns kept aside go here)' },
  { value: 'QUARANTINE', label: 'Quarantine — not pickable' },
] as const;

export function BinsIndex(): ReactElement {
  const toast = useToast();
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');

  const selected = useMemo(
    () => (warehouses.data ?? []).find((w) => w.id === warehouseId) ?? null,
    [warehouses.data, warehouseId],
  );
  // Land on the first warehouse rather than making the operator pick one
  // when, as today, there is exactly one.
  const activeId = warehouseId || (warehouses.data?.[0]?.id ?? '');
  const active = selected ?? warehouses.data?.[0] ?? null;

  const zones = useWarehouseZones(activeId);
  const bins = useWarehouseBins(activeId);
  const createZone = useCreateZone(activeId);
  const createBin = useCreateBin(activeId);
  const deleteBin = useDeleteBin(activeId);
  const setTracking = useSetBinTracking(activeId);
  // The same request the contents view above makes (one query key), read
  // here for the per-bin total on the layout table.
  const overview = useBinOverview();
  const totalsByBin = useMemo(
    () => new Map((overview.data?.warehouses ?? []).flatMap((w) => w.bins.map((b) => [b.id, b]))),
    [overview.data],
  );

  const [error, setError] = useState<string | null>(null);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [zoneForm, setZoneForm] = useState({ code: '', name: '' });
  const [binForm, setBinForm] = useState({
    zoneId: '',
    type: 'STORAGE',
    aisle: '',
    rack: '',
    shelf: '',
  });
  const [confirmToggle, setConfirmToggle] = useState(false);
  // Deleting a bin is irreversible, so it is confirmed first (owner). The
  // request itself is unchanged.
  const [confirmRemove, setConfirmRemove] = useState<WarehouseBin | null>(null);

  const preview = composeCode(binForm.aisle, binForm.rack, binForm.shelf);
  const existing = (bins.data ?? []).find((b) => b.code === preview) ?? null;
  const realBins = (bins.data ?? []).filter((b) => b.code !== 'FLOOR');

  async function submitZone(): Promise<void> {
    setError(null);
    try {
      await createZone.mutateAsync({
        code: zoneForm.code.trim().toUpperCase(),
        name: zoneForm.name.trim(),
      });
      toast.success(`Zone ${zoneForm.code.toUpperCase()} created`);
      setZoneForm({ code: '', name: '' });
      setZoneOpen(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  async function submitBin(): Promise<void> {
    setError(null);
    try {
      const created = await createBin.mutateAsync({
        zoneId: binForm.zoneId,
        type: binForm.type,
        aisle: binForm.aisle,
        rack: binForm.rack,
        shelf: binForm.shelf,
      });
      toast.success(`Bin ${created.code} created`);
      // Keep the aisle and rack — an operator adding shelving works
      // along a rack, not at random.
      setBinForm((f) => ({ ...f, shelf: '' }));
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  async function toggleTracking(): Promise<void> {
    if (active === null) return;
    setError(null);
    try {
      const next = !active.binTrackingEnabled;
      await setTracking.mutateAsync(next);
      toast.success(
        next
          ? 'Location tracking on — receiving will now ask where goods were put'
          : 'Location tracking off — receiving will stop asking. Nothing moved.',
      );
      setConfirmToggle(false);
    } catch (err) {
      setError(serverVerdict(err));
      setConfirmToggle(false);
    }
  }

  async function removeBin(bin: WarehouseBin): Promise<void> {
    setError(null);
    try {
      await deleteBin.mutateAsync(bin.id);
      toast.info(`Bin ${bin.code} removed`);
    } catch (err) {
      // The server refuses while a bin holds stock or an active
      // reservation — surfaced verbatim, because "which bin still has
      // something in it" is the useful part.
      setError(serverVerdict(err));
    }
  }

  if (warehouses.isLoading) return <SkeletonRows rows={6} label="Loading warehouses" />;

  return (
    <AreaPage>
      <PageHeader
        title="Bins"
        subtitle="Where stock physically sits and what is in each bin. The layout and the tracking switch are further down."
        action={
          <Actions>
            {(warehouses.data?.length ?? 0) > 1 && (
              <Select
                value={activeId}
                onChange={(e) => setWarehouseId(e.target.value)}
                aria-label="Warehouse"
              >
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </Select>
            )}
            {/* Buildings are created and renamed here because this is the
                only screen that already knows which one you are looking
                at. Until now a warehouse could only be created by seeding. */}
            {active !== null && <WarehouseFormPanel warehouse={active} />}
            <WarehouseFormPanel />
          </Actions>
        }
      />

      {error !== null && <InlineError message={error} />}

      {/* The primary view: every bin, across every warehouse, with what is
          on it. Management of the layout below is per warehouse. */}
      <BinContentsOverview />

      {active !== null && (
        <Panel
          title="Location tracking"
          subtitle={
            active.binTrackingEnabled
              ? 'On — receiving asks which bin the goods went into, and pick sheets name a shelf.'
              : 'Off — everything goes to FLOOR and pick sheets name no location. Receiving can still note one, but it is only a note.'
          }
        >
          <Note>
            {active.binTrackingEnabled
              ? 'Turning it off stops the system asking. It does NOT collapse the bins you have built — everything stays exactly where it is recorded.'
              : realBins.length === 0
                ? 'Create at least one bin below before turning this on, otherwise receiving would have nowhere to put anything.'
                : `Turning it on does not relocate what is already in FLOOR. New receipts go into real bins; the FLOOR pile drains as it is picked, or you move it deliberately.`}
          </Note>
          <Actions>
            <Button
              variant={active.binTrackingEnabled ? 'ghost' : 'primary'}
              size="md"
              disabled={
                setTracking.isPending || (!active.binTrackingEnabled && realBins.length === 0)
              }
              onClick={() => setConfirmToggle(true)}
            >
              {active.binTrackingEnabled ? 'Turn tracking off' : 'Turn tracking on'}
            </Button>
          </Actions>
        </Panel>
      )}

      <AreaSection
        title="Add a bin"
        note="The code is built from the three coordinates — you never type it. That is what stops one shelf becoming A-01-03, A-1-3 and a01-03."
      >
        <Panel>
          {(zones.data ?? []).length === 0 ? (
            <EmptyState
              bare
              title="No zones yet"
              description="A bin lives in a zone. Zones also carry pick order, so a picker walks the building in a sensible sequence."
              action={
                <Button
                  variant="primary"
                  size="md"
                  icon={<Plus size={16} />}
                  onClick={() => setZoneOpen(true)}
                >
                  Create a zone
                </Button>
              }
            />
          ) : (
            <>
              <FieldGrid columns={2}>
                <Select
                  label="Zone"
                  value={binForm.zoneId}
                  onChange={(e) => setBinForm((f) => ({ ...f, zoneId: e.target.value }))}
                >
                  <option value="">Choose…</option>
                  {(zones.data ?? []).map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.code} — {z.name}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Type"
                  value={binForm.type}
                  onChange={(e) => setBinForm((f) => ({ ...f, type: e.target.value }))}
                >
                  {BIN_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </FieldGrid>

              <FieldGrid columns={3}>
                <TextField
                  label="Aisle"
                  hint="1–2 letters"
                  value={binForm.aisle}
                  placeholder="A"
                  onChange={(e) => setBinForm((f) => ({ ...f, aisle: e.target.value }))}
                />
                <TextField
                  label="Rack"
                  hint="digits"
                  value={binForm.rack}
                  placeholder="1"
                  inputMode="numeric"
                  onChange={(e) => setBinForm((f) => ({ ...f, rack: e.target.value }))}
                />
                <TextField
                  label="Shelf"
                  hint="digits"
                  value={binForm.shelf}
                  placeholder="3"
                  inputMode="numeric"
                  onChange={(e) => setBinForm((f) => ({ ...f, shelf: e.target.value }))}
                />
              </FieldGrid>

              {/* Live feedback: what it will be called, and whether it
                  is already there. The duplicate case says what the
                  bin is, because "it exists" alone leaves the operator
                  wondering whether they mis-typed. */}
              <div aria-live="polite">
                {preview === null ? (
                  <Note tone="faint">
                    Fill all three to see the bin code — e.g. A + 1 + 3 becomes <Code>A-01-03</Code>
                    .
                  </Note>
                ) : existing !== null ? (
                  <Note tone="warn">
                    <Code>{preview}</Code> already exists
                    {existing.type !== binForm.type ? ` as a ${existing.type} bin` : ''}.
                  </Note>
                ) : (
                  <Note tone="good">
                    Will be created as <Code>{preview}</Code>.
                  </Note>
                )}
              </div>

              <Actions>
                <AsyncButton
                  variant="primary"
                  size="md"
                  icon={<Plus size={16} />}
                  state={mutationPhase(createBin)}
                  labels={{ idle: 'Add bin', busy: 'Creating…' }}
                  disabled={
                    preview === null ||
                    existing !== null ||
                    binForm.zoneId === '' ||
                    createBin.isPending
                  }
                  onClick={() => void submitBin()}
                />
                <Button variant="ghost" size="md" onClick={() => setZoneOpen(true)}>
                  Add a zone
                </Button>
              </Actions>
            </>
          )}
        </Panel>
      </AreaSection>

      <AreaSection title="Bins" note={`${realBins.length} bin(s) plus FLOOR.`}>
        {bins.isLoading ? (
          <SkeletonRows rows={5} cols={6} label="Loading bins" />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Bin</Th>
                <Th>Zone</Th>
                <Th>Type</Th>
                <Th>Pickable</Th>
                <Th align="right">On hand</Th>
                <Th> </Th>
              </Tr>
            </THead>
            <TBody>
              {(bins.data ?? []).length === 0 ? (
                <TableEmpty colSpan={6}>No bins yet.</TableEmpty>
              ) : (
                (bins.data ?? []).map((b) => {
                  const zone = (zones.data ?? []).find((z) => z.id === b.zoneId);
                  const isFloor = b.code === 'FLOOR';
                  const held = totalsByBin.get(b.id);
                  return (
                    <Tr key={b.id}>
                      <Td>
                        <Link href={`/warehouse/bins/${b.id}`} className="stk-link sk-ident">
                          {b.code}
                        </Link>
                        {isFloor && (
                          <span className="stk-sub">
                            the off-state bin — stock with no recorded location
                          </span>
                        )}
                      </Td>
                      <Td>{zone?.code ?? '—'}</Td>
                      <Td>{b.type}</Td>
                      <Td>
                        {NON_PICKABLE.has(b.type) ? <ToneText tone="bad">No</ToneText> : 'Yes'}
                      </Td>
                      <Td align="right">
                        {held === undefined ? (
                          '—'
                        ) : held.lineCount === 0 ? (
                          <ToneText tone="faint">Empty</ToneText>
                        ) : (
                          <span data-testid={`layout-total-${b.code}`} className="sk-figure">
                            <Num value={held.unitsOnHand} suffix=" units" /> ·{' '}
                            <Num
                              value={held.skuCount}
                              suffix={held.skuCount === 1 ? ' SKU' : ' SKUs'}
                            />
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        {!isFloor && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Trash2 size={14} />}
                            onClick={() => setConfirmRemove(b)}
                            disabled={deleteBin.isPending}
                          >
                            Remove
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  );
                })
              )}
            </TBody>
          </Table>
        )}
      </AreaSection>

      <Dialog
        open={zoneOpen}
        onOpenChange={setZoneOpen}
        title="New zone"
        footer={
          <DialogFooter>
            <Button variant="ghost" size="md" onClick={() => setZoneOpen(false)}>
              Cancel
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              state={mutationPhase(createZone)}
              labels={{ idle: 'Create zone', busy: 'Creating…' }}
              disabled={
                zoneForm.code.trim() === '' || zoneForm.name.trim() === '' || createZone.isPending
              }
              onClick={() => void submitZone()}
            />
          </DialogFooter>
        }
      >
        <FieldGrid columns={1}>
          <TextField
            label="Code"
            hint="Short, e.g. MAIN or RET"
            value={zoneForm.code}
            onChange={(e) => setZoneForm((f) => ({ ...f, code: e.target.value }))}
          />
          <TextField
            label="Name"
            value={zoneForm.name}
            onChange={(e) => setZoneForm((f) => ({ ...f, name: e.target.value }))}
          />
        </FieldGrid>
      </Dialog>

      <Dialog
        open={confirmToggle}
        onOpenChange={setConfirmToggle}
        title={active?.binTrackingEnabled === true ? 'Turn tracking off?' : 'Turn tracking on?'}
        footer={
          <DialogFooter>
            <Button variant="ghost" size="md" onClick={() => setConfirmToggle(false)}>
              Cancel
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              state={mutationPhase(setTracking)}
              labels={{ idle: 'Confirm', busy: 'Saving…' }}
              disabled={setTracking.isPending}
              onClick={() => void toggleTracking()}
            />
          </DialogFooter>
        }
      >
        <Note>
          {active?.binTrackingEnabled === true
            ? 'Receiving will stop asking where goods went, and pick sheets will stop naming a shelf. Nothing moves — every bin and everything in it stays exactly as recorded, and turning this back on restores the prompts.'
            : 'Receiving will start asking which bin goods went into, and pick sheets will name a shelf. Stock already in FLOOR is not relocated: it drains as it is picked, or you move it deliberately.'}
        </Note>
      </Dialog>

      <ConfirmDialog
        open={confirmRemove !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmRemove(null);
        }}
        title="Remove this bin?"
        entity={`${confirmRemove?.code ?? ''}${active !== null ? ` · ${active.code}` : ''}`}
        entityIsIdentifier
        consequence="The bin is deleted from this warehouse's layout and cannot be restored — the server refuses while it still holds stock or an active reservation."
        confirmLabel="Remove bin"
        destructive
        onConfirm={async () => {
          if (confirmRemove !== null) await removeBin(confirmRemove);
        }}
      />

      {/* Moving stock BETWEEN bins. Separate from laying out the shelving
          above, and deliberately below it: the layout is setup, this is a
          stock movement that writes paired TRANSFER_OUT/TRANSFER_IN. */}
      {activeId !== '' && <BinOpsPanel warehouseId={activeId} />}
    </AreaPage>
  );
}
