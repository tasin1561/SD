'use client';

import { useState, type ReactElement } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { useToast } from '@skydrop/ui/app/toast';
import type { ManifestDetail } from '@skydrop/api-client';
import { ManifestStatus } from '@skydrop/db';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useManifestsList, useMoveShipment } from '@/lib/api-hooks';
import {
  Actions,
  InlineError,
  Note,
  Stack,
  mutationPhase,
} from '../../../inventory/_components/stock-kit';

/**
 * WMS-7 — reassign a packed parcel from one DRAFT manifest to another.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * Packing auto-attaches a parcel to the DRAFT manifest for its
 * (courier, warehouse) pair, and a manifest is what the driver signs
 * for. With one courier there is one DRAFT per warehouse and nothing to
 * choose between, which is why `moveShipment` has had no caller since
 * M8. The moment a second courier account is packing from the same
 * building, a parcel attached to the wrong day's or the wrong carrier's
 * sheet can only be corrected here — and after the manifest is CLOSED
 * it cannot be corrected at all, because closing queues AWB generation.
 * Without this control the fix is a database edit.
 *
 * ── WHAT THE SERVER DECIDES, NOT US ──────────────────────────────────
 * Both manifests must be DRAFT and share courier + origin warehouse;
 * the shipment must be CREATED and packed. Every one of those is a
 * server guard with its own code (SOURCE_MANIFEST_CLOSED,
 * TARGET_MANIFEST_NOT_DRAFT, COURIER_MISMATCH, WAREHOUSE_MISMATCH,
 * SHIPMENT_NOT_MOVABLE, SHIPMENT_NOT_PACKED) and each is surfaced
 * verbatim. The target list is narrowed to DRAFT manifests of the same
 * courier + warehouse because that is the only useful set to offer —
 * it is a query filter, not a second copy of the rule.
 */
export function MoveShipmentPanel({
  manifestId,
  manifestNumber,
  status,
  courierCode,
  originWarehouseId,
  shipments,
}: {
  readonly manifestId: string;
  readonly manifestNumber: string;
  readonly status: ManifestDetail['status'];
  readonly courierCode: string;
  readonly originWarehouseId: string;
  readonly shipments: ManifestDetail['shipments'];
}): ReactElement | null {
  // COSMETIC (FE-2). The page is gated on `warehouse.view`, but moving a
  // parcel between manifests carries the same permission as closing one
  // (`warehouse.manifest.close`) — a picker who can read the manifest
  // would otherwise see a control the server always refuses.
  const mayMove = usePermission('warehouse.manifest.close');
  const toast = useToast();
  const move = useMoveShipment();

  const [open, setOpen] = useState(false);
  const [shipmentId, setShipmentId] = useState('');
  const [targetManifestId, setTargetManifestId] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setShipmentId('');
    setTargetManifestId('');
    setError(null);
  }

  async function onMove(): Promise<void> {
    setError(null);
    const moved = shipments.find((s) => s.id === shipmentId);
    try {
      const result = await move.mutateAsync({ shipmentId, targetManifestId });
      setOpen(false);
      reset();
      // Saying so matters: the move is idempotent, and reporting a no-op
      // as a real move is how someone concludes the wrong parcel moved.
      toast.success(
        result.alreadyOnTarget
          ? `${moved?.shipmentNumber ?? 'Shipment'} was already on that manifest — nothing changed.`
          : `${moved?.shipmentNumber ?? 'Shipment'} moved off ${manifestNumber}.`,
      );
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  if (!mayMove) return null;
  // Closing is irreversible and the server refuses a move afterwards; a
  // sheet with no parcels has nothing to move. Neither is worth a
  // disabled button that only explains itself on click.
  if (status !== ManifestStatus.DRAFT || shipments.length === 0) return null;

  return (
    <Actions>
      <Button
        variant="secondary"
        size="sm"
        icon={<ArrowRightLeft size={14} />}
        onClick={() => setOpen(true)}
      >
        Move a shipment to another manifest
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setOpen(false);
            reset();
          }
        }}
        title={`Move a shipment off ${manifestNumber}`}
        description="Only possible while both manifests are still DRAFT."
        footer={
          <DialogFooter>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              state={mutationPhase(move)}
              labels={{ idle: 'Move shipment', busy: 'Moving…' }}
              disabled={shipmentId === '' || targetManifestId === '' || move.isPending}
              onClick={() => void onMove()}
            />
          </DialogFooter>
        }
      >
        <Stack>
          <Note>
            The parcel leaves this manifest and joins the one you pick. Do it before either is
            closed — a closed manifest has already been sealed and its AWBs queued, and the driver
            signs for what is on the sheet.
          </Note>

          {error !== null && <InlineError message={error} />}

          <Select
            label="Shipment"
            requiredMark
            hint="Parcels currently attached to this manifest."
            value={shipmentId}
            onChange={(e) => setShipmentId(e.target.value)}
          >
            <option value="">Select a shipment…</option>
            {shipments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shipmentNumber} · {s.status}
              </option>
            ))}
          </Select>

          {/* Mounted only while the modal is open (Radix unmounts the
              portal when closed), so nobody spends a manifest-list round
              trip for a control they never touched. */}
          <TargetManifestPicker
            courierCode={courierCode}
            originWarehouseId={originWarehouseId}
            excludeManifestId={manifestId}
            value={targetManifestId}
            onChange={setTargetManifestId}
          />
        </Stack>
      </Dialog>
    </Actions>
  );
}

/**
 * The set of manifests a parcel could legitimately land on: DRAFT, same
 * courier, same origin warehouse, and not the one it is already on.
 *
 * When that set is empty the honest answer is that there is nowhere to
 * move to — saying so beats an empty dropdown, because "no other DRAFT
 * manifest" is the normal state of a single-courier warehouse rather
 * than a fault.
 */
function TargetManifestPicker({
  courierCode,
  originWarehouseId,
  excludeManifestId,
  value,
  onChange,
}: {
  readonly courierCode: string;
  readonly originWarehouseId: string;
  readonly excludeManifestId: string;
  readonly value: string;
  readonly onChange: (id: string) => void;
}): ReactElement {
  const list = useManifestsList({
    status: ManifestStatus.DRAFT,
    courierCode,
    warehouseId: originWarehouseId,
    page: 1,
    pageSize: 100,
  });

  if (list.isLoading) {
    return (
      <Select label="Target manifest" requiredMark disabled>
        <option>Loading manifests…</option>
      </Select>
    );
  }

  if (list.isError) {
    return (
      <div>
        <span className="stk-field-label">Target manifest</span>
        <InlineError
          message={serverVerdict(list.error, 'Could not load manifests.')}
          retry={() => void list.refetch()}
        />
      </div>
    );
  }

  const targets = (list.data?.items ?? []).filter((m) => m.id !== excludeManifestId);

  if (targets.length === 0) {
    return (
      <div>
        <span className="stk-field-label">Target manifest</span>
        <Note tone="faint">
          No other DRAFT manifest for {courierCode} at this warehouse. A second one appears once
          another manifest is open for the same courier and building — until then there is nowhere
          to move this parcel.
        </Note>
      </div>
    );
  }

  return (
    <Select
      label="Target manifest"
      requiredMark
      hint="DRAFT manifests for the same courier and warehouse. The server refuses anything else."
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select a manifest…</option>
      {targets.map((m) => (
        <option key={m.id} value={m.id}>
          {m.manifestNumber} · {m.shipmentCount} shipment(s)
        </option>
      ))}
    </Select>
  );
}
