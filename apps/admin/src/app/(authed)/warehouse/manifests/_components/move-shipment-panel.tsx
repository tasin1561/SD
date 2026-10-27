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
import { useT } from '@/i18n/client';

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
  const t = useT();
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
          ? t('warehouseManifestsMoveShipmentPanel.wasAlreadyOnThatManifest', {
              value: moved?.shipmentNumber ?? t('warehouseManifestsMoveShipmentPanel.shipment'),
            })
          : t('warehouseManifestsMoveShipmentPanel.movedOff', {
              value: moved?.shipmentNumber ?? t('warehouseManifestsMoveShipmentPanel.shipment'),
              manifestNumber,
            }),
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
        {t('warehouseManifestsMoveShipmentPanel.moveAShipmentToAnother')}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setOpen(false);
            reset();
          }
        }}
        title={t('warehouseManifestsMoveShipmentPanel.moveAShipmentOff', { manifestNumber })}
        description={t('warehouseManifestsMoveShipmentPanel.onlyPossibleWhileBothManifests')}
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
              {t('warehouseManifestsMoveShipmentPanel.cancel')}
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              state={mutationPhase(move)}
              labels={{
                idle: t('warehouseManifestsMoveShipmentPanel.moveShipment'),
                busy: t('warehouseManifestsMoveShipmentPanel.moving'),
              }}
              disabled={shipmentId === '' || targetManifestId === '' || move.isPending}
              onClick={() => void onMove()}
            />
          </DialogFooter>
        }
      >
        <Stack>
          <Note>{t('warehouseManifestsMoveShipmentPanel.theParcelLeavesThisManifest')}</Note>

          {error !== null && <InlineError message={error} />}

          <Select
            label={t('warehouseManifestsMoveShipmentPanel.shipment')}
            requiredMark
            hint={t('warehouseManifestsMoveShipmentPanel.parcelsCurrentlyAttachedToThis')}
            value={shipmentId}
            onChange={(e) => setShipmentId(e.target.value)}
          >
            <option value="">{t('warehouseManifestsMoveShipmentPanel.selectAShipment')}</option>
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
  const t = useT();
  const list = useManifestsList({
    status: ManifestStatus.DRAFT,
    courierCode,
    warehouseId: originWarehouseId,
    page: 1,
    pageSize: 100,
  });

  if (list.isLoading) {
    return (
      <Select label={t('warehouseManifestsMoveShipmentPanel.targetManifest')} requiredMark disabled>
        <option>{t('warehouseManifestsMoveShipmentPanel.loadingManifests')}</option>
      </Select>
    );
  }

  if (list.isError) {
    return (
      <div>
        <span className="stk-field-label">
          {t('warehouseManifestsMoveShipmentPanel.targetManifest')}
        </span>
        <InlineError
          message={serverVerdict(
            list.error,
            t('warehouseManifestsMoveShipmentPanel.couldNotLoadManifests'),
          )}
          retry={() => void list.refetch()}
        />
      </div>
    );
  }

  const targets = (list.data?.items ?? []).filter((m) => m.id !== excludeManifestId);

  if (targets.length === 0) {
    return (
      <div>
        <span className="stk-field-label">
          {t('warehouseManifestsMoveShipmentPanel.targetManifest')}
        </span>
        <Note tone="faint">
          {t('warehouseManifestsMoveShipmentPanel.noOtherDraftManifestFor', { courierCode })}
        </Note>
      </div>
    );
  }

  return (
    <Select
      label={t('warehouseManifestsMoveShipmentPanel.targetManifest')}
      requiredMark
      hint={t('warehouseManifestsMoveShipmentPanel.draftManifestsForTheSame')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t('warehouseManifestsMoveShipmentPanel.selectAManifest')}</option>
      {targets.map((m) => (
        <option key={m.id} value={m.id}>
          {t('warehouseManifestsMoveShipmentPanel.shipmentS', {
            manifestNumber: m.manifestNumber,
            shipmentCount: m.shipmentCount,
          })}
        </option>
      ))}
    </Select>
  );
}
