'use client';

import { useState, type ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Ident, Num } from '@skydrop/ui/components';
import { Truck } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import type { StatusKind } from '@skydrop/ui/status';
import {
  useClosePickup,
  usePickupRequests,
  useRaisePickup,
  useReleasePickupDay,
  useWarehouseOptions,
  type PickupRequestView,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import {
  Actions,
  AreaPage,
  Callout,
  FieldGrid,
  InlineError,
  Note,
  Panel,
  Stack,
  mutationPhase,
} from '../../../inventory/_components/stock-kit';

const MIN_RELEASE_REASON = 10;

/** Local to this screen: four statuses, not a product-wide vocabulary. */
function pickupKind(status: PickupRequestView['status']): StatusKind {
  switch (status) {
    case 'REQUESTED':
      return 'pending';
    case 'CLOSED':
      return 'delivered';
    case 'CANCELLED':
      return 'cancelled';
    case 'FAILED':
      return 'failed';
  }
}

/**
 * Pickup requests — asking the courier to send a van.
 *
 * The copy leans on one fact the screen exists to enforce: ONE request
 * covers a warehouse's whole handover for the day. An operator who
 * thinks in parcels will otherwise raise one per parcel.
 */
export function PickupsIndex(): ReactElement {
  const [raising, setRaising] = useState(false);
  const list = usePickupRequests();
  const rows = list.data ?? [];

  return (
    <AreaPage>
      <PageHeader
        breadcrumbs={[{ label: 'Warehouse', href: '/warehouse' }, { label: 'Pickups' }]}
        title="Pickups"
        subtitle="One request per warehouse per day covers the whole handover — not one per parcel. Raise it when the parcels are packed and ready to hand over."
        action={
          <Button
            variant="primary"
            size="md"
            icon={<Truck size={16} />}
            onClick={() => setRaising(true)}
          >
            Request a pickup
          </Button>
        }
      />

      {list.isError ? (
        <InlineError message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <SkeletonRows rows={4} cols={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No pickups requested"
          description="Once the day's parcels are packed, raise one request for the warehouse and the courier sends a van."
          action={
            <Button variant="primary" size="sm" onClick={() => setRaising(true)}>
              Request a pickup
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Date</Th>
              <Th>Warehouse</Th>
              <Th>Time</Th>
              <Th align="right">Parcels</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <PickupRow key={r.id} row={r} />
            ))}
          </TBody>
        </Table>
      )}

      <Panel>
        <Note>
          The courier accepts only one open request per location per day. A failed attempt keeps the
          day claimed on purpose — when a call fails we cannot tell whether they registered it, and
          assuming they did not is how two vans arrive. Free it only after checking their panel.
        </Note>
      </Panel>

      <RaisePickupModal open={raising} onOpenChange={setRaising} />
    </AreaPage>
  );
}

function PickupRow({ row }: { readonly row: PickupRequestView }): ReactElement {
  const toast = useToast();
  const close = useClosePickup();
  const release = useReleasePickupDay();
  const [releasing, setReleasing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const openRequest = row.status === 'REQUESTED';
  const releasable = row.status === 'FAILED' && row.courierPickupId === null;

  async function mark(status: 'CLOSED' | 'CANCELLED'): Promise<void> {
    try {
      await close.mutateAsync({ requestId: row.id, status });
      toast.success(status === 'CLOSED' ? 'Marked collected.' : 'Called off.');
    } catch (err) {
      toast.error(serverVerdict(err));
    }
  }

  async function doRelease(): Promise<void> {
    setError(null);
    try {
      await release.mutateAsync({ requestId: row.id, reason: reason.trim() });
      toast.success('Day freed. A new request can be raised for it.');
      setReleasing(false);
      setReason('');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Tr>
      <Td className="stk-nowrap">
        <Ident value={row.pickupDate} />
      </Td>
      <Td>
        {row.warehouseName ?? <Ident value={row.warehouseId.slice(0, 8)} />}
        <span className="stk-sub">as &ldquo;{row.pickupLocationName}&rdquo;</span>
      </Td>
      <Td className="stk-muted stk-nowrap sk-figure">{row.pickupTime}</Td>
      <Td align="right" className="sk-figure">
        <Num value={row.expectedPackageCount} />
      </Td>
      <Td>
        <StatusChip size="sm" kind={pickupKind(row.status)} label={row.status.toLowerCase()} />
        {row.courierMessage !== null && row.courierMessage !== '' && (
          <span className="stk-sub pku-message" title={row.courierMessage}>
            {row.courierMessage}
          </span>
        )}
      </Td>
      <Td align="right">
        <Actions end>
          {openRequest && (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={close.isPending}
                onClick={() => void mark('CLOSED')}
              >
                Collected
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={close.isPending}
                onClick={() => void mark('CANCELLED')}
              >
                Call off
              </Button>
            </>
          )}
          {releasable && (
            <Button variant="ghost" size="sm" onClick={() => setReleasing(true)}>
              Free the day
            </Button>
          )}
          {!openRequest && !releasable && <span className="stk-faint">—</span>}
        </Actions>

        <Dialog
          open={releasing}
          onOpenChange={(next) => {
            setReleasing(next);
            if (!next) setError(null);
          }}
          size="md"
          tone="critical"
          title="Free this day for a new request?"
          description="Only after confirming in the courier's panel that no request exists for this warehouse on this date. If one does, freeing the slot books a second van against a live request."
          footer={
            <DialogFooter>
              <Button variant="ghost" size="md" onClick={() => setReleasing(false)}>
                Cancel
              </Button>
              <AsyncButton
                variant="destructive"
                size="md"
                state={mutationPhase(release)}
                labels={{ idle: 'Free the day', busy: 'Freeing…' }}
                disabled={reason.trim().length < MIN_RELEASE_REASON || release.isPending}
                onClick={() => void doRelease()}
              />
            </DialogFooter>
          }
        >
          <Stack>
            <div role="alert">
              <Callout tone="bad" icon={<AlertTriangle size={14} />}>
                <p className="pku-callout">
                  This attempt failed without the courier returning an id, so it probably never
                  registered — but &ldquo;probably&rdquo; is why this is a deliberate act and
                  audited.
                </p>
              </Callout>
            </div>
            <p className="stk-note">
              <span className="sk-ident">{row.pickupDate}</span> ·{' '}
              {row.warehouseName ?? row.warehouseId.slice(0, 8)}
            </p>
            <TextArea
              id={`release-${row.id}`}
              label="Reason"
              requiredMark
              hint={`At least ${MIN_RELEASE_REASON} characters. Say what you checked.`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Checked the One panel — no request listed for this date."
            />
            {error !== null && <InlineError message={error} />}
          </Stack>
        </Dialog>
      </Td>
    </Tr>
  );
}

function RaisePickupModal({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const toast = useToast();
  const warehouses = useWarehouseOptions();
  const raise = useRaisePickup();

  const [warehouseId, setWarehouseId] = useState('');
  // WHICH courier's van. Delhivery is the default because that is what
  // this form asked for before it could ask anything else — the field
  // had not existed, so a Shiprocket parcel could summon its own van
  // automatically while nobody could raise one here.
  const [courierCode, setCourierCode] = useState<'delhivery' | 'shiprocket'>('delhivery');
  const [pickupDate, setPickupDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [pickupTime, setPickupTime] = useState('16:00:00');
  const [count, setCount] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    try {
      await raise.mutateAsync({
        warehouseId,
        courierCode,
        pickupDate,
        pickupTime,
        expectedPackageCount: Number(count),
      });
      toast.success('Pickup requested.');
      setCount('');
      onOpenChange(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
      size="md"
      title="Request a pickup"
      description="One request covers every parcel leaving this warehouse today. Raise it when they are packed and ready to hand over — not when they are manifested."
      footer={
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <AsyncButton
            variant="primary"
            size="md"
            icon={<Truck size={16} />}
            state={mutationPhase(raise)}
            labels={{ idle: 'Request pickup', busy: 'Requesting…' }}
            disabled={
              warehouseId === '' || count.trim() === '' || Number(count) < 1 || raise.isPending
            }
            onClick={() => void submit()}
          />
        </DialogFooter>
      }
    >
      <Stack>
        <Select
          id="pu-courier"
          label="Courier"
          requiredMark
          hint="One van per courier per building per day — a warehouse handing over to both needs one request each."
          value={courierCode}
          onChange={(e) =>
            setCourierCode(e.target.value === 'shiprocket' ? 'shiprocket' : 'delhivery')
          }
        >
          <option value="delhivery">Delhivery</option>
          <option value="shiprocket">Shiprocket</option>
        </Select>

        <Select
          id="pu-warehouse"
          label="Warehouse"
          requiredMark
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
        >
          <option value="">Choose a warehouse…</option>
          {warehouses.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.code})
            </option>
          ))}
        </Select>

        <FieldGrid columns={2}>
          <TextField
            id="pu-date"
            label="Date"
            requiredMark
            type="date"
            floatLabel
            value={pickupDate}
            onChange={(e) => setPickupDate(e.target.value)}
          />
          <TextField
            id="pu-time"
            label="Time"
            requiredMark
            type="time"
            floatLabel
            step={1}
            value={pickupTime}
            onChange={(e) =>
              setPickupTime(e.target.value.length === 5 ? `${e.target.value}:00` : e.target.value)
            }
          />
        </FieldGrid>

        <TextField
          id="pu-count"
          label="Parcels to hand over"
          requiredMark
          hint="The whole handover, not one parcel."
          inputMode="numeric"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          placeholder="20"
        />

        {error !== null && <InlineError message={error} />}
      </Stack>
    </Dialog>
  );
}
