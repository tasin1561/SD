'use client';

import { useState, type ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorNote,
  FormField,
  Ident,
  Input,
  Modal,
  ModalFooter,
  Num,
  PageHeader,
  Select,
  SkeletonRows,
  StatusBadge,
  TBody,
  Table,
  Td,
  Textarea,
  THead,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
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
    <div>
      <PageHeader
        title="Pickups"
        subtitle="One request per warehouse per day covers the whole handover — not one per parcel. Raise it when the parcels are packed and ready to hand over."
        action={
          <Button variant="primary" size="md" onClick={() => setRaising(true)}>
            Request a pickup
          </Button>
        }
      />

      {list.isError ? (
        <ErrorNote message={serverVerdict(list.error)} retry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <Card>
          <SkeletonRows rows={4} cols={6} />
        </Card>
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

      <Card className="mt-4">
        <CardBody>
          <p className="text-text-muted text-xs leading-relaxed">
            The courier accepts only one open request per location per day. A failed attempt keeps
            the day claimed on purpose — when a call fails we cannot tell whether they registered
            it, and assuming they did not is how two vans arrive. Free it only after checking their
            panel.
          </p>
        </CardBody>
      </Card>

      <RaisePickupModal open={raising} onOpenChange={setRaising} />
    </div>
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
      <Td className="whitespace-nowrap">
        <Ident value={row.pickupDate} />
      </Td>
      <Td>
        {row.warehouseName ?? <Ident value={row.warehouseId.slice(0, 8)} />}
        <div className="text-text-faint mt-0.5 text-xs">
          as &ldquo;{row.pickupLocationName}&rdquo;
        </div>
      </Td>
      <Td className="text-text-muted whitespace-nowrap">{row.pickupTime}</Td>
      <Td align="right">
        <Num value={row.expectedPackageCount} />
      </Td>
      <Td>
        <StatusBadge kind={pickupKind(row.status)} label={row.status.toLowerCase()} />
        {row.courierMessage !== null && row.courierMessage !== '' && (
          <div
            className="text-text-faint mt-0.5 max-w-[16rem] truncate text-xs"
            title={row.courierMessage}
          >
            {row.courierMessage}
          </div>
        )}
      </Td>
      <Td align="right">
        <div className="flex items-center justify-end gap-1.5">
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
          {!openRequest && !releasable && <span className="text-text-faint text-xs">—</span>}
        </div>

        <Modal
          open={releasing}
          onOpenChange={(next) => {
            setReleasing(next);
            if (!next) setError(null);
          }}
          size="md"
          tone="critical"
          title="Free this day for a new request?"
          description="Only after confirming in the courier's panel that no request exists for this warehouse on this date. If one does, freeing the slot books a second van against a live request."
        >
          <div
            role="alert"
            className="border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] mb-3 flex items-start gap-2 rounded-[var(--radius-2)] border px-3 py-2"
          >
            <AlertTriangle
              size={14}
              className="text-[var(--color-critical)] mt-0.5 shrink-0"
              aria-hidden
            />
            <p className="text-[var(--color-critical)] text-xs leading-relaxed">
              This attempt failed without the courier returning an id, so it probably never
              registered — but &ldquo;probably&rdquo; is why this is a deliberate act and audited.
            </p>
          </div>
          <FormField
            label="Reason"
            htmlFor={`release-${row.id}`}
            hint={`At least ${MIN_RELEASE_REASON} characters. Say what you checked.`}
            required
          >
            <Textarea
              id={`release-${row.id}`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Checked the One panel — no request listed for this date."
            />
          </FormField>
          {error !== null && <ErrorNote className="mt-3" message={error} />}
          <ModalFooter>
            <Button variant="ghost" size="md" onClick={() => setReleasing(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="md"
              disabled={reason.trim().length < MIN_RELEASE_REASON || release.isPending}
              onClick={() => void doRelease()}
            >
              {release.isPending ? 'Freeing…' : 'Free the day'}
            </Button>
          </ModalFooter>
        </Modal>
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
  const [pickupDate, setPickupDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [pickupTime, setPickupTime] = useState('16:00:00');
  const [count, setCount] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    try {
      await raise.mutateAsync({
        warehouseId,
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
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
      size="md"
      title="Request a pickup"
      description="One request covers every parcel leaving this warehouse today. Raise it when they are packed and ready to hand over — not when they are manifested."
    >
      <div className="space-y-3">
        <FormField label="Warehouse" htmlFor="pu-warehouse" required>
          <Select
            id="pu-warehouse"
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
        </FormField>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Date" htmlFor="pu-date" required>
            <Input
              id="pu-date"
              type="date"
              value={pickupDate}
              onChange={(e) => setPickupDate(e.target.value)}
            />
          </FormField>
          <FormField label="Time" htmlFor="pu-time" required>
            <Input
              id="pu-time"
              type="time"
              step={1}
              value={pickupTime}
              onChange={(e) =>
                setPickupTime(e.target.value.length === 5 ? `${e.target.value}:00` : e.target.value)
              }
            />
          </FormField>
        </div>

        <FormField
          label="Parcels to hand over"
          htmlFor="pu-count"
          hint="The whole handover, not one parcel."
          required
        >
          <Input
            id="pu-count"
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            placeholder="20"
          />
        </FormField>

        {error !== null && <ErrorNote message={error} />}
      </div>

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          disabled={
            warehouseId === '' || count.trim() === '' || Number(count) < 1 || raise.isPending
          }
          onClick={() => void submit()}
        >
          {raise.isPending ? 'Requesting…' : 'Request pickup'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
