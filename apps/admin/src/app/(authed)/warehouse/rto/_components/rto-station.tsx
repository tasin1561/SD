'use client';

import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { TextField } from '@skydrop/ui/app/text-field';
import { PackageOpen } from 'lucide-react';
import type { InspectRtoItemRequest, RtoShipmentItem } from '@skydrop/api-client';
import { PutawayPanel } from './putaway-panel';
import { RtoItemRow, type RtoInspectPayload } from './rto-item-row';
import type { RtoItemCondition, RtoDisposition } from '@skydrop/db';
import { serverVerdict } from '@/lib/server-verdict';
import { OpenReturns } from './open-returns';
import { AtOurDoorList, StillWithCourierList } from './awaiting-returns';
import { RtoTabPanel, RtoTabs, type RtoTab } from './rto-tabs';
import { BarcodeCamera, CameraScanButton } from '@/components/barcode-camera';
import {
  useReceiveRto,
  useInspectRtoItem,
  useFinalizeRto,
  useRtoShipmentDetail,
  useAwaitingRtoReceipt,
  useOpenRtoShipments,
} from '@/lib/api-hooks';
import '../../_components/benches.css';

/**
 * RTO workspace — three phases:
 *  1. Receive: enter AWB, click Receive → API stamps rtoReceivedAt and
 *     drives the order to RTO_RECEIVED.
 *  2. Inspect: for each shipment_item, pick a condition (GOOD / DAMAGED /
 *     MISSING) + a disposition (put back in stock / keep aside damaged /
 *     write off / decide later) + optional notes — once for the whole
 *     line, or, on a line of more than one unit, split BY QUANTITY
 *     (WMS-8d: "one good, one damaged"). The disposition decides what
 *     happens at finalize.
 *  3. Finalize: WMS-8 saga, per row (WMS-8e — receive already booked the
 *     units into the returns hold) — restocked units move to a sellable
 *     bin (floor, or their old shelf when bins are tracked); kept-aside
 *     units to the Damaged bin (never sellable); written-off units out of
 *     the hold. The order lands RTO_RESTOCKED when any unit was
 *     restocked, else RTO_DAMAGED.
 *
 * FE-2 verdict surfacing on every server error (`serverVerdict`).
 */
const TAB_VALUES: readonly RtoTab[] = ['door', 'transit', 'bench', 'receive'];

/**
 * What finalising will do, restated for the confirm: units per decision,
 * read off each line's inspection rows (or its one summary decision).
 * Display only — the server is the authority on whether it may finalise.
 */
function finalizeSummary(items: ReadonlyArray<RtoShipmentItem>): {
  readonly restock: number;
  readonly hold: number;
  readonly writeOff: number;
  readonly later: number;
  readonly uninspectedLines: number;
} {
  let restock = 0;
  let hold = 0;
  let writeOff = 0;
  let later = 0;
  let uninspectedLines = 0;
  for (const it of items) {
    const rows =
      it.rtoInspections.length > 0
        ? it.rtoInspections
        : it.rtoDisposition !== null
          ? [{ quantity: it.quantity, disposition: it.rtoDisposition }]
          : [];
    if (rows.length === 0) uninspectedLines += 1;
    for (const r of rows) {
      if (r.disposition === 'RESTOCK') restock += r.quantity;
      else if (r.disposition === 'HOLD_DAMAGED') hold += r.quantity;
      else if (r.disposition === 'WRITE_OFF') writeOff += r.quantity;
      else later += r.quantity;
    }
  }
  return { restock, hold, writeOff, later, uninspectedLines };
}

export function RtoStation(): ReactElement {
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [awb, setAwb] = useState('');
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  /*
    The tab lives in the URL.

    Refreshing after receiving a parcel should not throw somebody back to
    the first tab, and "look at this one" is a link somebody sends. An
    unknown or absent value falls back to `door` rather than erroring —
    a mistyped query string should show the page, not break it.
  */
  const tab: RtoTab = TAB_VALUES.includes(params.get('tab') as RtoTab)
    ? (params.get('tab') as RtoTab)
    : 'door';
  const go = useCallback(
    (next: RtoTab) => {
      const q = new URLSearchParams(params.toString());
      q.set('tab', next);
      // `scroll: false` — switching tabs is not navigating to a new
      // page, and jumping to the top loses the row somebody was reading.
      router.replace(`?${q.toString()}`, { scroll: false });
    },
    [params, router],
  );

  // Both lists are fetched HERE rather than inside their panels: the
  // counts belong on the tabs, and a count that only loads once you open
  // the tab is a count that cannot tell you to open it.
  const awaiting = useAwaitingRtoReceipt();
  const open = useOpenRtoShipments();
  const rows = useMemo(() => awaiting.data?.items ?? [], [awaiting.data]);
  const atDoor = useMemo(() => rows.filter((r) => r.stage === 'RETURNED'), [rows]);
  const inTransit = useMemo(() => rows.filter((r) => r.stage === 'ON_THE_WAY'), [rows]);

  /** A row click loads the parcel AND moves to the station — otherwise
   *  it fills a field on a tab you cannot see and looks like nothing
   *  happened. */
  const pickAwb = useCallback(
    (scanned: string) => {
      setAwb(scanned);
      go('receive');
    },
    [go],
  );
  const pickShipment = useCallback(
    (id: string) => {
      setShipmentId(id);
      go('receive');
    },
    [go],
  );

  const receive = useReceiveRto();
  const detail = useRtoShipmentDetail(shipmentId);
  const inspect = useInspectRtoItem();
  const finalize = useFinalizeRto();

  function fmtError(err: unknown): string {
    return serverVerdict(err, 'Operation failed');
  }

  /** The row's payload in the API's vocabulary (the values ARE the enum). */
  function toRequest(payload: RtoInspectPayload): InspectRtoItemRequest {
    if ('rows' in payload) {
      return {
        rows: payload.rows.map((r) => ({
          quantity: r.quantity,
          condition: r.condition as RtoItemCondition,
          disposition: r.disposition as RtoDisposition,
          ...(r.notes ? { notes: r.notes } : {}),
        })),
      };
    }
    return {
      condition: payload.condition as RtoItemCondition,
      disposition: payload.disposition as RtoDisposition,
      ...(payload.notes ? { notes: payload.notes } : {}),
    };
  }

  async function onReceive(): Promise<void> {
    setError(null);
    const a = awb.trim();
    if (!a) {
      setError('AWB is required.');
      return;
    }
    try {
      const r = await receive.mutateAsync({ awbNumber: a });
      setShipmentId(r.shipmentId);
      toast.success(
        r.alreadyReceived
          ? `Already received earlier — opening shipment ${r.shipmentId.slice(0, 8)}.`
          : `Received — order ${r.orderId.slice(0, 8)} → ${r.orderStatus}.` +
              // WMS-8e: said plainly, because the stock ledger will not
              // show this return until it is finalised.
              (r.holdBooking?.outcome === 'NO_HOLD_BIN'
                ? ' This warehouse has no returns hold bin, so the units are not on the stock ledger until you finalise — create one under Warehouse → Bins.'
                : ''),
      );
    } catch (err) {
      setError(fmtError(err));
    }
  }

  async function onFinalize(): Promise<boolean> {
    if (!shipmentId) return false;
    setError(null);
    try {
      const r = await finalize.mutateAsync({ shipmentId });
      // Units, not lines: a split line is one line and two outcomes.
      toast.success(
        `Finalized — ${r.restockedUnits} unit(s) put back in stock, ${r.heldDamagedUnits} kept aside damaged, ` +
          `${r.writtenOffUnits} written off. Order ${r.status}.`,
      );
      setShipmentId(null);
      setAwb('');
      return true;
    } catch (err) {
      setError(fmtError(err));
      return false;
    }
  }

  return (
    <div className="wh-stack">
      <RtoTabs
        active={tab}
        onChange={go}
        counts={{
          door: atDoor.length,
          transit: inTransit.length,
          bench: open.data?.items.length ?? 0,
        }}
      />

      {tab === 'door' && (
        <RtoTabPanel subtitle="The courier has handed these back and nobody has received them here yet. Receiving one is what starts its inspection — nothing does it automatically, on purpose. Click a parcel to load it into the station.">
          <AtOurDoorList rows={atDoor} onPick={pickAwb} />
        </RtoTabPanel>
      )}

      {tab === 'transit' && (
        <RtoTabPanel subtitle="On their way back. Nothing to do yet — this is here so the bench knows what is coming, and so a return that has been travelling for weeks is visible somewhere.">
          <StillWithCourierList rows={inTransit} />
        </RtoTabPanel>
      )}

      {tab === 'bench' && (
        <RtoTabPanel subtitle="Received here and not yet finalised. Two things hold a return up and they need different answers: items nobody has inspected, and items somebody looked at and could not decide about.">
          <OpenReturns onPick={pickShipment} />
        </RtoTabPanel>
      )}

      <div className={tab === 'receive' ? 'wh-stack' : 'wh-hidden'}>
        <section className="wh-card wh-stack">
          <h2 className="wh-title">Receive</h2>
          <div className="wh-fields wh-receive-awb">
            <TextField
              label="AWB number"
              inputClassName="sk-ident"
              value={awb}
              onChange={(e) => setAwb(e.target.value)}
              placeholder="DL12345678"
              disabled={receive.isPending}
            />
            {/* The label on a returned parcel is the same barcode the
                courier printed, so the bench should not have to read
                thirteen digits off a battered box and type them. */}
            <div className="wh-row">
              <CameraScanButton onClick={() => setCamera(true)} />
              <Button
                variant="primary"
                size="lg"
                disabled={receive.isPending || !awb.trim()}
                onClick={() => void onReceive()}
              >
                {receive.isPending ? 'Receiving…' : 'Receive'}
              </Button>
            </div>
          </div>
        </section>

        {error && (
          <div role="alert" className="wh-alert">
            {error}
          </div>
        )}

        {!shipmentId ? (
          <EmptyState
            icon={<PackageOpen size={26} />}
            title="No shipment selected"
            description="Receive an inbound RTO by AWB to begin inspection."
          />
        ) : detail.isLoading ? (
          <section className="wh-card">
            <SkeletonRows rows={3} cols={3} label="Loading shipment…" />
          </section>
        ) : detail.isError || !detail.data ? (
          <div role="alert" className="wh-alert">
            Failed to load shipment.
          </div>
        ) : (
          <section className="wh-card wh-stack">
            <div className="wh-row wh-row--between">
              <div>
                <div className="wh-title">
                  Shipment <span className="sk-ident">{detail.data.shipmentNumber}</span>
                </div>
                <div className="wh-faint">
                  <span className="sk-figure">{detail.data.items.length}</span> line(s)
                </div>
              </div>
              {detail.data.orderStatus !== null && (
                <StatusChip
                  kind={orderStatusKind(detail.data.orderStatus)}
                  label={statusLabel(detail.data.orderStatus)}
                />
              )}
            </div>
            <div className="wh-stack wh-stack--tight">
              {detail.data.items.map((it) => (
                <RtoItemRow
                  key={it.shipmentItemId}
                  item={it}
                  onSave={async (payload) => {
                    setError(null);
                    try {
                      await inspect.mutateAsync({
                        shipmentItemId: it.shipmentItemId,
                        ...toRequest(payload),
                      });
                      toast.success(`Line inspected.`);
                      await detail.refetch();
                    } catch (err) {
                      setError(fmtError(err));
                    }
                  }}
                  saving={inspect.isPending}
                />
              ))}
            </div>
            <div className="wh-row wh-row--end">
              <Button
                variant="primary"
                size="md"
                disabled={finalize.isPending}
                onClick={() => {
                  setError(null);
                  setFinalizeOpen(true);
                }}
              >
                {finalize.isPending ? 'Finalizing…' : 'Finalize disposition'}
              </Button>
            </div>
            <FinalizeConfirm
              open={finalizeOpen}
              onOpenChange={setFinalizeOpen}
              shipmentNumber={detail.data.shipmentNumber}
              items={detail.data.items}
              error={error}
              onConfirm={async () => {
                const ok = await onFinalize();
                if (!ok) throw new Error('refused');
                setFinalizeOpen(false);
              }}
            />
          </section>
        )}

        {/* Only for a unit an OLDER finalise left in the returns hold (a
          return finalised now is already sellable — WMS-8e). The panel
          renders nothing when there is nothing to shelve, so it appears
          exactly when there is work. */}
        {shipmentId !== null && <PutawayPanel shipmentId={shipmentId} />}
      </div>

      {/* Mounted outside the tab panel so a scan started here survives
          the tab switch that follows it. */}
      <BarcodeCamera
        open={camera}
        onClose={() => setCamera(false)}
        onScan={(scanned) => {
          setCamera(false);
          // Straight into the field rather than receiving on the spot:
          // receiving is what drives the order to RTO_RECEIVED and
          // starts the inspection, so it stays a deliberate click. A
          // misread digit that silently received the wrong parcel is a
          // worse trade than one extra press.
          setAwb(scanned);
        }}
        title="Scan the return label"
      />
    </div>
  );
}

function FinalizeConfirm({
  open,
  onOpenChange,
  shipmentNumber,
  items,
  error,
  onConfirm,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly shipmentNumber: string;
  readonly items: ReadonlyArray<RtoShipmentItem>;
  readonly error: string | null;
  readonly onConfirm: () => Promise<void>;
}): ReactElement {
  const t = finalizeSummary(items);
  const unit = (n: number): string => `${n} unit${n === 1 ? '' : 's'}`;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Finalize this return?"
      entity={shipmentNumber}
      entityIsIdentifier
      consequence={`${unit(t.restock)} go back in stock, ${unit(t.hold)} are kept aside damaged and ${unit(t.writeOff)} are written off — stock moves now and this cannot be undone.`}
      confirmLabel="Finalize disposition"
      destructive={t.writeOff > 0}
      error={error}
      onConfirm={onConfirm}
    >
      {t.later > 0 || t.uninspectedLines > 0 ? (
        <p className="wh-note">
          {t.later > 0 ? `${unit(t.later)} marked Decide later. ` : ''}
          {t.uninspectedLines > 0 ? `${t.uninspectedLines} line(s) not inspected yet. ` : ''}A
          return cannot be finalised until every line has a decision — the server will say so.
        </p>
      ) : null}
    </ConfirmDialog>
  );
}
