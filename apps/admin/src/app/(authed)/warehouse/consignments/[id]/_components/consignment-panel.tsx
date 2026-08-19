'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactElement } from 'react';
import { ConsignmentLeg, ConsignmentRoute, LabellingSite } from '@skydrop/db';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  ErrorNote,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  Select,
  StatusBadge,
  useToast,
} from '@skydrop/ui/components';
import { consignmentStatusKind } from '@skydrop/ui/status';
import type { ConsignmentLegView, LabelSheet } from '@skydrop/api-client';
import {
  useCancelConsignment,
  useConsignmentDetail,
  useConsignmentEvents,
  useConsignmentLabelPreview,
  useDispatchConsignment,
  usePrintConsignmentLabels,
  useSetLabellingSite,
} from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { ROUTE_LABEL, SITE_LABEL, STATUS_LABEL } from '../../_components/labels';
import { LabelSheetView } from './label-sheet';
import { Step, Variance } from './steps';

const dt = (v: string | null): string =>
  v === null
    ? '—'
    : new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export function ConsignmentPanel({ id }: { readonly id: string }): ReactElement {
  const toast = useToast();
  const detail = useConsignmentDetail(id);
  const events = useConsignmentEvents(id);
  const labelPreview = useConsignmentLabelPreview(id);

  const mayManage = usePermission('inventory.goods_receipts.manage');
  const mayDispatch = usePermission('inventory.transfers.manage');

  const setSite = useSetLabellingSite();
  const printLabels = usePrintConsignmentLabels();
  const dispatch = useDispatchConsignment();
  const cancel = useCancelConsignment();

  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<LabelSheet | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [dispatchQty, setDispatchQty] = useState<Record<string, string>>({});
  const [etaAt, setEtaAt] = useState('');
  const [reference, setReference] = useState('');

  const c = detail.data;
  const bdLeg = useMemo(
    () => c?.receipts.find((r) => r.leg === ConsignmentLeg.BD_INTAKE) ?? null,
    [c],
  );
  const finalLegs = useMemo(
    () => c?.receipts.filter((r) => r.leg === ConsignmentLeg.IN_FINAL) ?? [],
    [c],
  );

  /**
   * How many of each line are still standing in Bangladesh: counted at
   * the intake, minus everything already put on an India leg. A
   * consignment can be dispatched more than once, so this is what the
   * form defaults to rather than the full counted quantity.
   */
  const remaining = useMemo(() => {
    const out = new Map<string, number>();
    if (!bdLeg) return out;
    for (const line of bdLeg.lines) {
      const dispatched = finalLegs
        .flatMap((leg) => leg.lines)
        .filter((l) => l.variantId === line.variantId)
        .reduce((n, l) => n + l.expectedQty, 0);
      out.set(line.id, Math.max(0, (line.receivedQty ?? 0) - dispatched));
    }
    return out;
  }, [bdLeg, finalLegs]);

  if (detail.isLoading) return <LoadingState rows={8} />;
  if (detail.isError || !c) {
    return (
      <ErrorState message="Could not load this consignment." retry={() => void detail.refetch()} />
    );
  }

  const anythingDispatched = c.receipts.some((r) => r.dispatchedAt !== null);
  const cancellable = !anythingDispatched && c.cancelledAt === null && c.status !== 'COMPLETED';
  const viaBd = c.route === ConsignmentRoute.VIA_BD;
  const declaredUnits = (bdLeg ?? finalLegs[0])?.lines.reduce((n, l) => n + l.expectedQty, 0) ?? 0;

  async function onSetSite(site: LabellingSite): Promise<void> {
    setError(null);
    try {
      await setSite.mutateAsync({ id, site });
      toast.success(`Labelling moved to ${SITE_LABEL[site]}`);
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  async function onPrint(): Promise<void> {
    setError(null);
    try {
      const result = await printLabels.mutateAsync({ id });
      setSheet(result);
      toast.success(`${result.labels.length} label(s) ready`);
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  async function onDispatch(): Promise<void> {
    setError(null);
    if (!bdLeg) return;
    const lines = bdLeg.lines
      .map((l) => ({
        lineId: l.id,
        quantity: Number(dispatchQty[l.id] ?? remaining.get(l.id) ?? 0),
      }))
      .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0);
    if (lines.length === 0) {
      setError('Enter how many units are leaving on this shipment.');
      return;
    }
    try {
      const result = await dispatch.mutateAsync({
        id,
        body: {
          lines,
          ...(etaAt === '' ? {} : { etaAt: new Date(etaAt).toISOString() }),
          ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        },
      });
      setDispatchQty({});
      setEtaAt('');
      setReference('');
      toast.success(
        `${result.unitsDispatched} unit(s) on their way — leg ${result.legReceiptNumber}`,
      );
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  async function onCancel(): Promise<void> {
    setError(null);
    try {
      const result = await cancel.mutateAsync({ id, reason: reason.trim() });
      setCancelOpen(false);
      setReason('');
      toast.success(
        result.unitsReturned > 0
          ? `Cancelled — ${result.unitsReturned} unit(s) removed and going back to the seller`
          : 'Cancelled before anything arrived',
      );
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  return (
    <div>
      <PageHeader
        title={c.consignmentNumber}
        subtitle={`${c.seller.companyName} · ${ROUTE_LABEL[c.route]}`}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge kind={consignmentStatusKind(c.status)} label={STATUS_LABEL[c.status]} />
            {mayManage && cancellable && (
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                Cancel consignment
              </Button>
            )}
          </div>
        }
      />

      {error !== null && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      <Card className="mb-4">
        <CardBody>
          <DescriptionList
            items={[
              { label: 'Seller', value: `${c.seller.companyName} — ${c.seller.emailDisplay}` },
              { label: 'Route', value: ROUTE_LABEL[c.route] },
              { label: 'Their reference', value: c.sellerReference ?? '—' },
              { label: 'Expected arrival', value: dt(c.expectedArrivalAt) },
              {
                label: 'Freight bill',
                value:
                  c.freightCharge === null
                    ? viaBd
                      ? 'Not recorded yet'
                      : 'Not billable — they shipped it themselves'
                    : `₹${c.freightCharge.totalInr} · ${c.freightCharge.status}`,
              },
              ...(c.cancelledAt === null
                ? []
                : [
                    { label: 'Cancelled', value: `${dt(c.cancelledAt)} — ${c.cancelReason ?? ''}` },
                  ]),
            ]}
          />
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader title="The journey" />
        <CardBody>
          <Step
            n={1}
            title="Announced"
            state={`${declaredUnits} unit(s) across ${(bdLeg ?? finalLegs[0])?.lines.length ?? 0} product(s), declared ${dt(c.createdAt)}`}
          />

          {viaBd && (
            <Step
              n={2}
              title="Bangladesh intake"
              state={
                bdLeg === null
                  ? 'No intake leg — this should not happen; check the consignment was declared as VIA_BD.'
                  : bdLeg.status === 'COMPLETED'
                    ? `Counted ${dt(bdLeg.receivedAt)} at ${bdLeg.warehouse.name}`
                    : `Waiting to be counted at ${bdLeg.warehouse.name}`
              }
            >
              {bdLeg !== null && (
                <div>
                  <LegLines leg={bdLeg} shortWord="short of declared" overWord="over declared" />
                  {bdLeg.status !== 'COMPLETED' && (
                    <Link
                      href={`/warehouse/receive/${bdLeg.id}`}
                      className="text-accent mt-2 inline-block text-sm underline"
                    >
                      Count it on the receive station →
                    </Link>
                  )}
                </div>
              )}
            </Step>
          )}

          <Step
            n={viaBd ? 3 : 2}
            title="Labelling"
            state={
              c.labelsPrintedAt !== null
                ? `Printed in ${SITE_LABEL[c.labellingSite]} on ${dt(c.labelsPrintedAt)} — the station is locked`
                : c.labellingSite === LabellingSite.NONE
                  ? 'No station chosen. Only STRICT-mode SKUs are labelled; the rest are counted in aggregate.'
                  : `Set to ${SITE_LABEL[c.labellingSite]}, nothing printed yet`
            }
          >
            <div className="flex flex-col gap-2">
              {c.labelsPrintedAt !== null ? (
                <p className="text-text-muted text-sm">
                  The station cannot be moved now. A consignment half-labelled in one country and
                  half in the other cannot be told apart without opening every carton.
                </p>
              ) : (
                mayManage && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      aria-label="Labelling station"
                      value={c.labellingSite}
                      onChange={(e) => void onSetSite(e.target.value as LabellingSite)}
                      disabled={setSite.isPending}
                    >
                      <option value="NONE">{SITE_LABEL.NONE}</option>
                      {viaBd && <option value="BD">{SITE_LABEL.BD}</option>}
                      <option value="IN">{SITE_LABEL.IN}</option>
                    </Select>
                  </div>
                )
              )}
              {labelPreview.data !== undefined && (
                <p className="text-text-muted text-sm tabular-nums">
                  {labelPreview.data.strictUnits === 0
                    ? 'Nothing to label — no serialised units are waiting at this station.'
                    : `${labelPreview.data.strictUnits} unit(s) across ${labelPreview.data.strictSkus} strict SKU(s) waiting.`}
                </p>
              )}
              {mayManage &&
                c.labellingSite !== LabellingSite.NONE &&
                (labelPreview.data?.strictUnits ?? 0) > 0 && (
                  <div>
                    <Button onClick={() => void onPrint()} disabled={printLabels.isPending}>
                      {printLabels.isPending ? 'Preparing…' : 'Print labels'}
                    </Button>
                  </div>
                )}
            </div>
          </Step>

          {viaBd && (
            <Step
              n={4}
              title="Dispatch to India"
              state={
                finalLegs.length === 0
                  ? 'Nothing sent yet'
                  : `${finalLegs.length} shipment(s) sent — a large intake can travel in several`
              }
            >
              {bdLeg !== null && bdLeg.status === 'COMPLETED' && mayDispatch ? (
                <div className="flex flex-col gap-3">
                  <p className="text-text-muted text-sm">
                    Dispatched stock sits in the Indian warehouse&apos;s transit location. It is on
                    hand and cannot be sold until it lands and is counted.
                  </p>
                  <div className="flex flex-col gap-2">
                    {bdLeg.lines.map((l) => {
                      const left = remaining.get(l.id) ?? 0;
                      return (
                        <div key={l.id} className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 text-sm">
                            <span className="font-mono">{l.variant.skuCode}</span>{' '}
                            <span className="text-text-muted">
                              {l.variant.product.name}
                              {l.variant.variantLabel === null
                                ? ''
                                : ` — ${l.variant.variantLabel}`}
                            </span>
                          </span>
                          <span className="text-text-muted text-sm tabular-nums">
                            {left} still in Dhaka
                          </span>
                          <Input
                            type="number"
                            min={0}
                            max={left}
                            aria-label={`Units of ${l.variant.skuCode} leaving`}
                            className="w-24"
                            value={dispatchQty[l.id] ?? String(left)}
                            onChange={(e) =>
                              setDispatchQty((p) => ({ ...p, [l.id]: e.target.value }))
                            }
                            disabled={left === 0}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField label="Expected arrival in India">
                      <Input type="date" value={etaAt} onChange={(e) => setEtaAt(e.target.value)} />
                    </FormField>
                    <FormField label="Forwarder reference">
                      <Input
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        placeholder="Optional"
                      />
                    </FormField>
                  </div>
                  <div>
                    <Button onClick={() => void onDispatch()} disabled={dispatch.isPending}>
                      {dispatch.isPending ? 'Sending…' : 'Send to India'}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-text-muted text-sm">
                  {bdLeg === null || bdLeg.status !== 'COMPLETED'
                    ? 'Count the Bangladesh intake first — we can only forward what we know we have.'
                    : 'You do not have permission to move stock between warehouses.'}
                </p>
              )}
            </Step>
          )}

          <Step
            n={viaBd ? 5 : 3}
            title={viaBd ? 'Arrival in India' : 'Arrival'}
            state={
              finalLegs.length === 0
                ? 'Nothing has arrived yet'
                : `${finalLegs.filter((l) => l.status === 'COMPLETED').length} of ${finalLegs.length} shipment(s) counted`
            }
          >
            <div className="flex flex-col gap-4">
              {finalLegs.length === 0 ? (
                <p className="text-text-muted text-sm">—</p>
              ) : (
                finalLegs.map((leg) => (
                  <div key={leg.id} className="border-border-subtle rounded-[8px] border p-3">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-sm">{leg.receiptNumber}</span>
                      <span className="text-text-muted text-xs">
                        {leg.dispatchedAt === null
                          ? 'shipped direct by the seller'
                          : `left Bangladesh ${dt(leg.dispatchedAt)}`}
                        {leg.receivedAt === null ? '' : ` · counted ${dt(leg.receivedAt)}`}
                      </span>
                    </div>
                    <LegLines
                      leg={leg}
                      shortWord={
                        leg.dispatchedAt === null ? 'short of declared' : 'lost in transit'
                      }
                      overWord={leg.dispatchedAt === null ? 'over declared' : 'more than was sent'}
                    />
                    {leg.status !== 'COMPLETED' && (
                      <Link
                        href={`/warehouse/receive/${leg.id}`}
                        className="text-accent mt-2 inline-block text-sm underline"
                      >
                        Count it on the receive station →
                      </Link>
                    )}
                  </div>
                ))
              )}
            </div>
          </Step>
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader title="Timeline" />
        <CardBody>
          {events.isLoading ? (
            <LoadingState rows={3} />
          ) : (events.data?.length ?? 0) === 0 ? (
            <p className="text-text-muted text-sm">Nothing recorded yet.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {(events.data ?? []).map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span className="text-text-muted w-40 shrink-0 tabular-nums">
                    {dt(e.createdAt)}
                  </span>
                  <span className="min-w-0">{e.description ?? e.type}</span>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      {sheet !== null && <LabelSheetView sheet={sheet} onClose={() => setSheet(null)} />}

      <Modal
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        tone="critical"
        title={`Cancel ${c.consignmentNumber}?`}
      >
        <p className="text-text-muted mb-3 text-sm">
          Stock already booked in will be removed from Skydrop and returned to the seller. This is
          impossible once the goods have left Bangladesh, so it cannot be undone by dispatching
          later.
        </p>
        <FormField label="Why" required>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="At least 10 characters — recorded permanently"
          />
        </FormField>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setCancelOpen(false)}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            onClick={() => void onCancel()}
            disabled={cancel.isPending || reason.trim().length < 10}
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel and return the goods'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function LegLines({
  leg,
  shortWord,
  overWord,
}: {
  readonly leg: ConsignmentLegView;
  readonly shortWord: string;
  readonly overWord: string;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      {leg.lines.map((l) => (
        <div key={l.id} className="flex flex-wrap items-baseline gap-2 text-sm">
          <span className="font-mono">{l.variant.skuCode}</span>
          <span className="text-text-muted min-w-0 flex-1 truncate">
            {l.variant.product.name}
            {l.variant.variantLabel === null ? '' : ` — ${l.variant.variantLabel}`}
          </span>
          <Variance
            expected={l.expectedQty}
            counted={leg.status === 'COMPLETED' ? (l.receivedQty ?? 0) : null}
            shortWord={shortWord}
            overWord={overWord}
          />
        </div>
      ))}
      {leg.discrepancyNotes !== null && (
        <p className="text-text-muted mt-1 text-xs">{leg.discrepancyNotes}</p>
      )}
    </div>
  );
}
