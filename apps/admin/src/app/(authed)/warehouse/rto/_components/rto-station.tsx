'use client';

import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  FormField,
  Input,
  useToast,
} from '@skydrop/ui/components';
import type { InspectRtoItemRequest } from '@skydrop/api-client';
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

export function RtoStation(): ReactElement {
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [awb, setAwb] = useState('');
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);

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

  async function onFinalize(): Promise<void> {
    if (!shipmentId) return;
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
    } catch (err) {
      setError(fmtError(err));
    }
  }

  return (
    <>
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

      <div className={tab === 'receive' ? 'space-y-4' : 'hidden'}>
        <Card>
          <CardBody>
            <h2 className="text-text-bright text-sm font-medium mb-3">Receive</h2>
            <div className="flex items-end gap-2">
              <FormField label="AWB number">
                <Input
                  value={awb}
                  onChange={(e) => setAwb(e.target.value)}
                  placeholder="DL12345678"
                  disabled={receive.isPending}
                />
              </FormField>
              {/* The label on a returned parcel is the same barcode the
                  courier printed, so the bench should not have to read
                  thirteen digits off a battered box and type them. */}
              <CameraScanButton onClick={() => setCamera(true)} />
              <Button
                variant="primary"
                size="md"
                disabled={receive.isPending || !awb.trim()}
                onClick={() => void onReceive()}
              >
                {receive.isPending ? 'Receiving…' : 'Receive'}
              </Button>
            </div>
          </CardBody>
        </Card>

        {error && (
          <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
            {error}
          </div>
        )}

        {!shipmentId ? (
          <EmptyState
            title="No shipment selected"
            description="Receive an inbound RTO by AWB to begin inspection."
          />
        ) : detail.isLoading ? (
          <Card>
            <CardBody>Loading shipment…</CardBody>
          </Card>
        ) : detail.isError || !detail.data ? (
          <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
            Failed to load shipment.
          </div>
        ) : (
          <Card>
            <CardBody>
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <div className="text-text-bright font-medium text-sm">
                    Shipment {detail.data.shipmentNumber}
                  </div>
                  <div className="text-text-faint text-xs mt-0.5">
                    Order status: {detail.data.orderStatus ?? '—'} · {detail.data.items.length}{' '}
                    line(s)
                  </div>
                </div>
              </div>
              <div className="space-y-2">
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
              <div className="mt-4 flex justify-end">
                <Button
                  variant="primary"
                  size="md"
                  disabled={finalize.isPending}
                  onClick={() => void onFinalize()}
                >
                  {finalize.isPending ? 'Finalizing…' : 'Finalize disposition'}
                </Button>
              </div>
            </CardBody>
          </Card>
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
    </>
  );
}
