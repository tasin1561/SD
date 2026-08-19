'use client';

import { useMemo, useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorNote,
  FormField,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Section,
  Select,
  Table,
  TableEmpty,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useToast,
} from '@skydrop/ui/components';
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
import { WarehouseFormPanel } from '../../_components/warehouse-form-panel';
import { BinOpsPanel } from './bin-ops-panel';
import { serverVerdict } from '@/lib/server-verdict';
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
  { value: 'DAMAGED', label: 'Damaged — not pickable' },
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

  if (warehouses.isLoading) return <LoadingState label="Loading warehouses" />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bins"
        subtitle="Where stock physically sits. Build the layout here; the switch below decides whether the system asks for it."
        action={
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
        }
      />

      {error !== null && <ErrorNote message={error} />}

      {active !== null && (
        <Card>
          <CardHeader
            title="Location tracking"
            subtitle={
              active.binTrackingEnabled
                ? 'On — receiving asks which bin the goods went into, and pick sheets name a shelf.'
                : 'Off — everything goes to FLOOR and pick sheets name no location. Receiving can still note one, but it is only a note.'
            }
          />
          <CardBody className="space-y-3">
            <div className="text-text-muted text-sm">
              {active.binTrackingEnabled
                ? 'Turning it off stops the system asking. It does NOT collapse the bins you have built — everything stays exactly where it is recorded.'
                : realBins.length === 0
                  ? 'Create at least one bin below before turning this on, otherwise receiving would have nowhere to put anything.'
                  : `Turning it on does not relocate what is already in FLOOR. New receipts go into real bins; the FLOOR pile drains as it is picked, or you move it deliberately.`}
            </div>
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
          </CardBody>
        </Card>
      )}

      <Section
        title="Add a bin"
        subtitle="The code is built from the three coordinates — you never type it. That is what stops one shelf becoming A-01-03, A-1-3 and a01-03."
      >
        <Card>
          <CardBody className="space-y-3">
            {(zones.data ?? []).length === 0 ? (
              <EmptyState
                title="No zones yet"
                description="A bin lives in a zone. Zones also carry pick order, so a picker walks the building in a sensible sequence."
                action={
                  <Button variant="primary" size="md" onClick={() => setZoneOpen(true)}>
                    Create a zone
                  </Button>
                }
              />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Zone">
                    <Select
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
                  </FormField>
                  <FormField label="Type">
                    <Select
                      value={binForm.type}
                      onChange={(e) => setBinForm((f) => ({ ...f, type: e.target.value }))}
                    >
                      {BIN_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField label="Aisle" hint="1–2 letters">
                    <Input
                      value={binForm.aisle}
                      placeholder="A"
                      onChange={(e) => setBinForm((f) => ({ ...f, aisle: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Rack" hint="digits">
                    <Input
                      value={binForm.rack}
                      placeholder="1"
                      inputMode="numeric"
                      onChange={(e) => setBinForm((f) => ({ ...f, rack: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Shelf" hint="digits">
                    <Input
                      value={binForm.shelf}
                      placeholder="3"
                      inputMode="numeric"
                      onChange={(e) => setBinForm((f) => ({ ...f, shelf: e.target.value }))}
                    />
                  </FormField>
                </div>

                {/* Live feedback: what it will be called, and whether it
                    is already there. The duplicate case says what the
                    bin is, because "it exists" alone leaves the operator
                    wondering whether they mis-typed. */}
                <div className="text-sm" aria-live="polite">
                  {preview === null ? (
                    <span className="text-text-faint">
                      Fill all three to see the bin code — e.g. A + 1 + 3 becomes{' '}
                      <span className="font-mono">A-01-03</span>.
                    </span>
                  ) : existing !== null ? (
                    <span className="text-[var(--status-pending-fg)]">
                      <span className="font-mono">{preview}</span> already exists
                      {existing.type !== binForm.type ? ` as a ${existing.type} bin` : ''}.
                    </span>
                  ) : (
                    <span className="text-[var(--status-delivered-fg)]">
                      Will be created as <span className="font-mono">{preview}</span>.
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="md"
                    disabled={
                      preview === null ||
                      existing !== null ||
                      binForm.zoneId === '' ||
                      createBin.isPending
                    }
                    onClick={() => void submitBin()}
                  >
                    {createBin.isPending ? 'Creating…' : 'Add bin'}
                  </Button>
                  <Button variant="ghost" size="md" onClick={() => setZoneOpen(true)}>
                    Add a zone
                  </Button>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </Section>

      <Section title="Bins" subtitle={`${realBins.length} bin(s) plus FLOOR.`}>
        <Card>
          <CardBody className="p-0">
            {bins.isLoading ? (
              <LoadingState label="Loading bins" />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Bin</Th>
                    <Th>Zone</Th>
                    <Th>Type</Th>
                    <Th>Pickable</Th>
                    <Th> </Th>
                  </Tr>
                </THead>
                <TBody>
                  {(bins.data ?? []).length === 0 ? (
                    <TableEmpty colSpan={5}>No bins yet.</TableEmpty>
                  ) : (
                    (bins.data ?? []).map((b) => {
                      const zone = (zones.data ?? []).find((z) => z.id === b.zoneId);
                      const isFloor = b.code === 'FLOOR';
                      return (
                        <Tr key={b.id}>
                          <Td>
                            <span className="font-mono">{b.code}</span>
                            {isFloor && (
                              <span className="text-text-faint ml-2 text-xs">
                                the off-state bin — stock with no recorded location
                              </span>
                            )}
                          </Td>
                          <Td>{zone?.code ?? '—'}</Td>
                          <Td>{b.type}</Td>
                          <Td>
                            {NON_PICKABLE.has(b.type) ? (
                              <span className="text-[var(--status-rto-fg)]">No</span>
                            ) : (
                              'Yes'
                            )}
                          </Td>
                          <Td>
                            {!isFloor && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void removeBin(b)}
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
          </CardBody>
        </Card>
      </Section>

      <Modal open={zoneOpen} onOpenChange={setZoneOpen} title="New zone">
        <div className="space-y-3">
          <FormField label="Code" hint="Short, e.g. MAIN or RET">
            <Input
              value={zoneForm.code}
              onChange={(e) => setZoneForm((f) => ({ ...f, code: e.target.value }))}
            />
          </FormField>
          <FormField label="Name">
            <Input
              value={zoneForm.name}
              onChange={(e) => setZoneForm((f) => ({ ...f, name: e.target.value }))}
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
              disabled={
                zoneForm.code.trim() === '' || zoneForm.name.trim() === '' || createZone.isPending
              }
              onClick={() => void submitZone()}
            >
              Create zone
            </Button>
            <Button variant="ghost" size="md" onClick={() => setZoneOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={confirmToggle}
        onOpenChange={setConfirmToggle}
        title={active?.binTrackingEnabled === true ? 'Turn tracking off?' : 'Turn tracking on?'}
      >
        <div className="space-y-3">
          <p className="text-text-muted text-sm">
            {active?.binTrackingEnabled === true
              ? 'Receiving will stop asking where goods went, and pick sheets will stop naming a shelf. Nothing moves — every bin and everything in it stays exactly as recorded, and turning this back on restores the prompts.'
              : 'Receiving will start asking which bin goods went into, and pick sheets will name a shelf. Stock already in FLOOR is not relocated: it drains as it is picked, or you move it deliberately.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
              disabled={setTracking.isPending}
              onClick={() => void toggleTracking()}
            >
              {setTracking.isPending ? 'Saving…' : 'Confirm'}
            </Button>
            <Button variant="ghost" size="md" onClick={() => setConfirmToggle(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Moving stock BETWEEN bins. Separate from laying out the shelving
          above, and deliberately below it: the layout is setup, this is a
          stock movement that writes paired TRANSFER_OUT/TRANSFER_IN. */}
      {activeId !== '' && <BinOpsPanel warehouseId={activeId} />}
    </div>
  );
}
