'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactElement } from 'react';
import { ConsignmentLeg, ConsignmentRoute, InboundFreightMode, LabellingSite } from '@skydrop/db';
import { Money, useToast } from '@skydrop/ui/components';
import { Ban, Plane, Printer, Tag } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Stepper } from '@skydrop/ui/app/stepper';
import { TextField } from '@skydrop/ui/app/text-field';
import { Timeline } from '@skydrop/ui/app/timeline';
import {
  consignmentStatusKind,
  freightModeExplainer,
  freightModeWords,
  FREIGHT_MODES,
} from '@skydrop/ui/status';
import type { ConsignmentLegView, LabelSheet } from '@skydrop/api-client';
import {
  useCancelConsignment,
  useConsignmentDetail,
  useConsignmentEvents,
  useConsignmentFreightMode,
  useConsignmentLabelPreview,
  useDispatchConsignment,
  usePrintConsignmentLabels,
  useRequestLabelReprint,
  useSetConsignmentFreightMode,
  useSetLabellingSite,
} from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { ROUTE_LABEL, SITE_LABEL, STATUS_LABEL } from '../../_components/labels';
import {
  Actions,
  AreaPage,
  Code,
  Facts,
  FieldGrid,
  InlineError,
  Note,
  Panel,
  Stack,
  TextLink,
  mutationPhase,
} from '../../../../inventory/_components/stock-kit';
import './consignment.css';

/** A scanner types one serial then Enter; a person pastes a list. Both
 *  shapes land in the same box, so accept either. */
function parseSerials(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .filter((x) => x.length > 0),
    ),
  ];
}
import { LabelReprintRequests } from './label-reprint-requests';
import { LabelSheetView } from './label-sheet';
import { Step, Variance } from './steps';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

const dt = (v: string | null): string =>
  v === null
    ? '—'
    : new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export function ConsignmentPanel({ id }: { readonly id: string }): ReactElement {
  const t = useT();
  const toast = useToast();
  const detail = useConsignmentDetail(id);
  const events = useConsignmentEvents(id);
  const labelPreview = useConsignmentLabelPreview(id);

  const mayManage = usePermission('inventory.goods_receipts.manage');
  const mayDispatch = usePermission('inventory.transfers.manage');

  const setSite = useSetLabellingSite();
  const printLabels = usePrintConsignmentLabels();
  const requestReprint = useRequestLabelReprint();
  const [reprinting, setReprinting] = useState(false);
  const [reprintSerials, setReprintSerials] = useState('');
  const [reprintReason, setReprintReason] = useState('');
  const dispatch = useDispatchConsignment();
  const cancel = useCancelConsignment();

  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<LabelSheet | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [dispatchQty, setDispatchQty] = useState<Record<string, string>>({});
  const [etaAt, setEtaAt] = useState('');
  const [reference, setReference] = useState('');
  // Dispatch to India cannot be undone (the cancel window closes, CNS-6),
  // so each of the two dispatch buttons is confirmed first (owner). The
  // request each one sends is unchanged.
  const [confirmDispatch, setConfirmDispatch] = useState<'counted' | 'uncounted' | null>(null);

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

  if (detail.isLoading)
    return (
      <SkeletonRows
        rows={8}
        label={t('warehouseConsignmentsIdConsignmentPanel.loadingConsignment')}
      />
    );
  if (detail.isError || !c) {
    return (
      <ErrorState
        message={t('warehouseConsignmentsIdConsignmentPanel.couldNotLoadThisConsignment')}
        retry={() => void detail.refetch()}
      />
    );
  }

  const anythingDispatched = c.receipts.some((r) => r.dispatchedAt !== null);
  const cancellable = !anythingDispatched && c.cancelledAt === null && c.status !== 'COMPLETED';
  const viaBd = c.route === ConsignmentRoute.VIA_BD;
  // A WITHDRAWN bill gave its money back, so it is not a charge against
  // this consignment and must not sit beside a live one as though it
  // were. Voided bills stay reachable on /freight by asking for them.
  const declaredUnits = (bdLeg ?? finalLegs[0])?.lines.reduce((n, l) => n + l.expectedQty, 0) ?? 0;

  async function onSetSite(site: LabellingSite): Promise<void> {
    setError(null);
    try {
      await setSite.mutateAsync({ id, site });
      toast.success(
        t('warehouseConsignmentsIdConsignmentPanel.labellingMovedTo', { value: SITE_LABEL[site] }),
      );
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  async function onPrint(): Promise<void> {
    setError(null);
    try {
      const result = await printLabels.mutateAsync({ id });
      setSheet(result);
      toast.success(
        t('warehouseConsignmentsIdConsignmentPanel.labelSReady', {
          labelsLength: result.labels.length,
        }),
      );
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  /**
   * The damaged sticker — named units only, it says why, and it prints
   * nothing: somebody else approves it first (LBL-5b).
   */
  async function onReprint(): Promise<void> {
    setError(null);
    try {
      const result = await requestReprint.mutateAsync({
        id,
        serials: parseSerials(reprintSerials),
        reason: reprintReason.trim(),
      });
      toast.success(
        t('warehouseConsignmentsIdConsignmentPanel.askedToReprintLabelS', {
          serialsLength: result.serials.length,
        }),
      );
      setReprinting(false);
      setReprintSerials('');
      setReprintReason('');
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  /**
   * Send it on WITHOUT opening it. A sealed carton going straight to
   * India can travel on the seller's declared quantities and be counted
   * once, when it lands — counting it twice is hours the Dhaka bench may
   * not have. Its own action rather than a fallback for an uncounted
   * leg, because it is a decision somebody makes on purpose.
   */
  async function onForwardUncounted(): Promise<void> {
    setError(null);
    try {
      const result = await dispatch.mutateAsync({
        id,
        body: {
          withoutCounting: true,
          ...(etaAt === '' ? {} : { etaAt: new Date(etaAt).toISOString() }),
          ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        },
      });
      setEtaAt('');
      setReference('');
      toast.success(
        t('warehouseConsignmentsIdConsignmentPanel.sentOnUnopenedDeclaredUnit', {
          unitsDispatched: result.unitsDispatched,
          legReceiptNumber: result.legReceiptNumber,
        }),
      );
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
      setError(t('warehouseConsignmentsIdConsignmentPanel.enterHowManyUnitsAre'));
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
        t('warehouseConsignmentsIdConsignmentPanel.unitSOnTheirWay', {
          unitsDispatched: result.unitsDispatched,
          legReceiptNumber: result.legReceiptNumber,
        }),
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
          ? t('warehouseConsignmentsIdConsignmentPanel.cancelledUnitSRemovedAnd', {
              unitsReturned: result.unitsReturned,
            })
          : t('warehouseConsignmentsIdConsignmentPanel.cancelledBeforeAnythingArrived'),
      );
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  // ── Presentation only: where the journey stands, for the stepper. ──
  const labellingDone =
    c.labelsPrintedAt !== null ||
    (labelPreview.data !== undefined && labelPreview.data.strictUnits === 0);
  const arrivedAll = finalLegs.length > 0 && finalLegs.every((l) => l.status === 'COMPLETED');
  const journey: ReadonlyArray<{ id: string; label: string; done: boolean }> = [
    {
      id: 'cns-announced',
      label: t('warehouseConsignmentsIdConsignmentPanel.announced'),
      done: true,
    },
    ...(viaBd
      ? [
          {
            id: 'cns-bd',
            label: t('warehouseConsignmentsIdConsignmentPanel.bangladeshIntake'),
            done: bdLeg?.status === 'COMPLETED',
          },
        ]
      : []),
    {
      id: 'cns-labelling',
      label: t('warehouseConsignmentsIdConsignmentPanel.labelling'),
      done: labellingDone,
    },
    ...(viaBd
      ? [
          {
            id: 'cns-dispatch',
            label: t('warehouseConsignmentsIdConsignmentPanel.dispatchToIndia'),
            done: finalLegs.length > 0,
          },
        ]
      : []),
    {
      id: 'cns-arrival',
      label: viaBd
        ? t('warehouseConsignmentsIdConsignmentPanel.arrivalInIndia')
        : t('warehouseConsignmentsIdConsignmentPanel.arrival'),
      done: arrivedAll,
    },
  ];
  const firstOpen = journey.findIndex((s) => !s.done);
  const journeyAt = firstOpen < 0 ? journey.length : firstOpen;
  const phaseOf = (stepId: string): 'done' | 'current' | 'todo' => {
    const i = journey.findIndex((s) => s.id === stepId);
    return i < journeyAt ? 'done' : i === journeyAt ? 'current' : 'todo';
  };

  // What the dispatch confirm restates — the same sum `onDispatch` sends.
  const dispatchUnits =
    bdLeg === null
      ? 0
      : bdLeg.lines
          .map((l) => Number(dispatchQty[l.id] ?? remaining.get(l.id) ?? 0))
          .filter((q) => Number.isFinite(q) && q > 0)
          .reduce((n, q) => n + q, 0);

  const eventRows = events.data ?? [];

  return (
    <AreaPage>
      <PageHeader
        Link={Link}
        breadcrumbs={[
          { label: t('warehouseConsignmentsIdConsignmentPanel.warehouse'), href: '/warehouse' },
          {
            label: t('warehouseConsignmentsIdConsignmentPanel.consignments'),
            href: '/warehouse/consignments',
          },
          { label: c.consignmentNumber },
        ]}
        title={<span className="sk-ident">{c.consignmentNumber}</span>}
        subtitle={`${c.seller.companyName} · ${ROUTE_LABEL[c.route]}`}
        meta={<StatusChip kind={consignmentStatusKind(c.status)} label={STATUS_LABEL[c.status]} />}
        action={
          mayManage && cancellable ? (
            <Button
              variant="destructive"
              icon={<Ban size={16} />}
              onClick={() => setCancelOpen(true)}
            >
              {t('warehouseConsignmentsIdConsignmentPanel.cancelConsignment')}
            </Button>
          ) : undefined
        }
      />

      {error !== null && <InlineError message={error} />}

      <Panel>
        <Facts
          columns={3}
          items={[
            {
              label: t('warehouseConsignmentsIdConsignmentPanel.client'),
              value: `${c.seller.companyName} — ${c.seller.emailDisplay}`,
            },
            {
              label: t('warehouseConsignmentsIdConsignmentPanel.route'),
              value: ROUTE_LABEL[c.route],
            },
            {
              label: t('warehouseConsignmentsIdConsignmentPanel.theirReference'),
              value: c.sellerReference ?? '—',
            },
            {
              label: t('warehouseConsignmentsIdConsignmentPanel.expectedArrival'),
              value: dt(c.expectedArrivalAt),
            },
            {
              // One bill per ARRIVAL, so this is a total across however
              // many shipments have landed — a consignment arriving in
              // two parts carries two forwarder invoices.
              label:
                c.freightCharges.length > 1
                  ? t('warehouseConsignmentsIdConsignmentPanel.freightBills', {
                      freightChargesLength: c.freightCharges.length,
                    })
                  : t('warehouseConsignmentsIdConsignmentPanel.freightBill'),
              value:
                c.freightCharges.length === 0
                  ? viaBd
                    ? t('warehouseConsignmentsIdConsignmentPanel.notRecordedYet')
                    : t('warehouseConsignmentsIdConsignmentPanel.notBillableTheyShippedIt')
                  : c.freightCharges.map((f, i) => (
                      <span key={f.id}>
                        {i > 0 ? '  ·  ' : ''}
                        <Money amount={f.totalInr} currency="INR" convert={false} /> ·{' '}
                        {f.status.toLowerCase()}
                      </span>
                    )),
            },
            ...(c.cancelledAt === null
              ? []
              : [
                  {
                    label: t('warehouseConsignmentsIdConsignmentPanel.cancelled'),
                    value: `${dt(c.cancelledAt)} — ${c.cancelReason ?? ''}`,
                  },
                ]),
          ]}
        />
      </Panel>

      <Panel title={t('warehouseConsignmentsIdConsignmentPanel.theJourney')}>
        <Stepper
          mode="wizard"
          navigable="none"
          label={t('warehouseConsignmentsIdConsignmentPanel.consignmentJourney')}
          current={journeyAt}
          steps={journey.map((s) => ({ id: `${s.id}-rail`, label: s.label }))}
        />
        <div className="cns-steps">
          <Step
            n={1}
            id="cns-announced"
            phase={phaseOf('cns-announced')}
            title={t('warehouseConsignmentsIdConsignmentPanel.announced')}
            state={`${declaredUnits} unit(s) across ${(bdLeg ?? finalLegs[0])?.lines.length ?? 0} product(s), declared ${dt(c.createdAt)}`}
          />

          {viaBd && (
            <Step
              n={2}
              id="cns-bd"
              phase={phaseOf('cns-bd')}
              title={t('warehouseConsignmentsIdConsignmentPanel.bangladeshIntake')}
              state={
                bdLeg === null
                  ? t('warehouseConsignmentsIdConsignmentPanel.noIntakeLegThisShould')
                  : bdLeg.status === 'COMPLETED'
                    ? bdLeg.forwardedWithoutCount
                      ? t('warehouseConsignmentsIdConsignmentPanel.handledAtAndSentOn', {
                          name: bdLeg.warehouse.name,
                        })
                      : t('warehouseConsignmentsIdConsignmentPanel.countedAt', {
                          value: dt(bdLeg.receivedAt),
                          name: bdLeg.warehouse.name,
                        })
                    : t('warehouseConsignmentsIdConsignmentPanel.waitingToBeCountedAt', {
                        name: bdLeg.warehouse.name,
                      })
              }
            >
              {bdLeg !== null && (
                <Stack tight>
                  {!bdLeg.forwardedWithoutCount && (
                    <LegLines
                      leg={bdLeg}
                      shortWord={t('warehouseConsignmentsIdConsignmentPanel.shortOfDeclared')}
                      overWord={t('warehouseConsignmentsIdConsignmentPanel.overDeclared')}
                    />
                  )}
                  {bdLeg.status !== 'COMPLETED' && (
                    <p className="stk-note">
                      <TextLink href={`/warehouse/receive/${bdLeg.id}`}>
                        {t('warehouseConsignmentsIdConsignmentPanel.countItOnTheReceive')}
                      </TextLink>
                    </p>
                  )}
                  {/* The freight decision sits HERE because this is when
                      it is made: the Dhaka count and weight are what a
                      pay-in-advance bill is priced from, so whoever is
                      standing at this leg is the person who knows. */}
                  <FreightModeControl id={id} />
                </Stack>
              )}
            </Step>
          )}

          <Step
            n={viaBd ? 3 : 2}
            id="cns-labelling"
            phase={phaseOf('cns-labelling')}
            title={t('warehouseConsignmentsIdConsignmentPanel.labelling')}
            state={
              c.labelsPrintedAt !== null
                ? t('warehouseConsignmentsIdConsignmentPanel.printedInOnTheStation', {
                    value: SITE_LABEL[c.labellingSite],
                    value2: dt(c.labelsPrintedAt),
                  })
                : c.labellingSite === LabellingSite.NONE
                  ? t('warehouseConsignmentsIdConsignmentPanel.noStationChosenOnlyStrict')
                  : t('warehouseConsignmentsIdConsignmentPanel.setToNothingPrintedYet', {
                      value: SITE_LABEL[c.labellingSite],
                    })
            }
          >
            <Stack tight>
              {c.labelsPrintedAt !== null ? (
                <Note>{t('warehouseConsignmentsIdConsignmentPanel.theStationCannotBeMoved')}</Note>
              ) : (
                mayManage && (
                  <div className="cns-narrow">
                    <Select
                      aria-label={t('warehouseConsignmentsIdConsignmentPanel.labellingStation')}
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
                <p className="stk-note sk-figure">
                  {labelPreview.data.strictUnits === 0
                    ? t('warehouseConsignmentsIdConsignmentPanel.nothingToLabelNoSerialised')
                    : t('warehouseConsignmentsIdConsignmentPanel.unitSAcrossStrictSku', {
                        strictUnits: labelPreview.data.strictUnits,
                        strictSkus: labelPreview.data.strictSkus,
                      })}
                </p>
              )}
              {mayManage &&
                c.labelsPrintedAt === null &&
                c.labellingSite !== LabellingSite.NONE &&
                (labelPreview.data?.strictUnits ?? 0) > 0 && (
                  <Actions>
                    <AsyncButton
                      icon={<Printer size={16} />}
                      state={mutationPhase(printLabels)}
                      labels={{
                        idle: t('warehouseConsignmentsIdConsignmentPanel.printLabels'),
                        busy: t('warehouseConsignmentsIdConsignmentPanel.preparing'),
                      }}
                      onClick={() => void onPrint()}
                      disabled={printLabels.isPending}
                    />
                  </Actions>
                )}

              {/* Printed once, and that is the whole point: a serial
                  names ONE physical unit, so a second copy of the sheet
                  is a duplicate sticker on every one of them. The
                  damaged label goes through here instead — named units
                  only, and two people (LBL-5b): one asks, somebody else
                  approves, the one who asked prints it once. */}
              {c.labelsPrintedAt !== null && (
                <div className="cns-reprint">
                  {!mayManage ? null : !reprinting ? (
                    <button
                      type="button"
                      className="stk-textbtn"
                      onClick={() => setReprinting(true)}
                    >
                      {t('warehouseConsignmentsIdConsignmentPanel.aLabelWasDamagedOr')}
                    </button>
                  ) : (
                    <Stack tight>
                      <Note>
                        {t('warehouseConsignmentsIdConsignmentPanel.nameTheUnitsOnlyReprinting')}
                      </Note>
                      <input
                        className="stk-input"
                        data-mono="1"
                        aria-label={t('warehouseConsignmentsIdConsignmentPanel.serialsToReprint')}
                        value={reprintSerials}
                        placeholder={t(
                          'warehouseConsignmentsIdConsignmentPanel.scanOrTypeTheSerials',
                        )}
                        onChange={(e) => setReprintSerials(e.target.value)}
                      />
                      <input
                        className="stk-input"
                        aria-label={t('warehouseConsignmentsIdConsignmentPanel.why')}
                        value={reprintReason}
                        placeholder={t(
                          'warehouseConsignmentsIdConsignmentPanel.whatHappenedToTheOriginal',
                        )}
                        onChange={(e) => setReprintReason(e.target.value)}
                      />
                      <Actions>
                        <AsyncButton
                          icon={<Tag size={16} />}
                          state={mutationPhase(requestReprint)}
                          labels={{
                            idle: t('warehouseConsignmentsIdConsignmentPanel.askForApproval'),
                            busy: t('warehouseConsignmentsIdConsignmentPanel.sending'),
                          }}
                          disabled={
                            requestReprint.isPending ||
                            reprintReason.trim().length === 0 ||
                            parseSerials(reprintSerials).length === 0
                          }
                          onClick={() => void onReprint()}
                        />
                        <Button variant="ghost" onClick={() => setReprinting(false)}>
                          {t('warehouseConsignmentsIdConsignmentPanel.cancel')}
                        </Button>
                      </Actions>
                    </Stack>
                  )}
                  <LabelReprintRequests consignmentId={id} onSheet={setSheet} />
                </div>
              )}
            </Stack>
          </Step>

          {viaBd && (
            <Step
              n={4}
              id="cns-dispatch"
              phase={phaseOf('cns-dispatch')}
              title={t('warehouseConsignmentsIdConsignmentPanel.dispatchToIndia')}
              state={
                finalLegs.length === 0
                  ? t('warehouseConsignmentsIdConsignmentPanel.nothingSentYet')
                  : t('warehouseConsignmentsIdConsignmentPanel.shipmentSSentALarge', {
                      length: finalLegs.length,
                    })
              }
            >
              {bdLeg !== null && bdLeg.status === 'COMPLETED' && mayDispatch ? (
                <Stack>
                  <Note>
                    {t('warehouseConsignmentsIdConsignmentPanel.dispatchedStockSitsInThe')}
                  </Note>
                  <div className="cns-lines">
                    {bdLeg.lines.map((l) => {
                      const left = remaining.get(l.id) ?? 0;
                      return (
                        <div key={l.id} className="cns-line">
                          <span className="cns-line__name">
                            <Code>{l.variant.skuCode}</Code>{' '}
                            <span className="stk-muted">
                              {l.variant.product.name}
                              {l.variant.variantLabel === null
                                ? ''
                                : ` — ${l.variant.variantLabel}`}
                            </span>
                          </span>
                          <span className="stk-muted sk-figure cns-line__left">
                            {t('warehouseConsignmentsIdConsignmentPanel.stillInDhaka', { left })}
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={left}
                            aria-label={t(
                              'warehouseConsignmentsIdConsignmentPanel.unitsOfLeaving',
                              { skuCode: l.variant.skuCode },
                            )}
                            className="stk-input sk-figure cns-line__qty"
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
                  <FieldGrid columns={2}>
                    <TextField
                      label={t('warehouseConsignmentsIdConsignmentPanel.expectedArrivalInIndia')}
                      type="date"
                      floatLabel
                      value={etaAt}
                      onChange={(e) => setEtaAt(e.target.value)}
                    />
                    <TextField
                      label={t('warehouseConsignmentsIdConsignmentPanel.forwarderReference')}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder={t('warehouseConsignmentsIdConsignmentPanel.optional')}
                    />
                  </FieldGrid>
                  <Actions>
                    <AsyncButton
                      icon={<Plane size={16} />}
                      state={mutationPhase(dispatch)}
                      labels={{
                        idle: t('warehouseConsignmentsIdConsignmentPanel.sendToIndia'),
                        busy: t('warehouseConsignmentsIdConsignmentPanel.sending'),
                      }}
                      onClick={() => setConfirmDispatch('counted')}
                      disabled={dispatch.isPending}
                    />
                  </Actions>
                </Stack>
              ) : !mayDispatch ? (
                <Note>{t('warehouseConsignmentsIdConsignmentPanel.youDoNotHavePermission')}</Note>
              ) : bdLeg !== null && bdLeg.status !== 'COMPLETED' ? (
                // The uncounted option lives HERE, where somebody is
                // deciding what to do with a carton in front of them —
                // not as a checkbox on the counted form, where it would
                // be an easy misclick with no way back.
                <Stack>
                  <Note>{t('warehouseConsignmentsIdConsignmentPanel.itHasNotBeenCounted')}</Note>
                  <FieldGrid columns={2}>
                    <TextField
                      label={t('warehouseConsignmentsIdConsignmentPanel.expectedArrivalInIndia')}
                      type="date"
                      floatLabel
                      value={etaAt}
                      onChange={(e) => setEtaAt(e.target.value)}
                    />
                    <TextField
                      label={t('warehouseConsignmentsIdConsignmentPanel.forwarderReference')}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder={t('warehouseConsignmentsIdConsignmentPanel.optional')}
                    />
                  </FieldGrid>
                  <Actions>
                    <TextLink href={`/warehouse/receive/${bdLeg.id}`}>
                      {t('warehouseConsignmentsIdConsignmentPanel.countItFirst')}
                    </TextLink>
                    <AsyncButton
                      variant="secondary"
                      state={mutationPhase(dispatch)}
                      labels={{
                        idle: t('warehouseConsignmentsIdConsignmentPanel.sendOnWithoutCounting'),
                        busy: t('warehouseConsignmentsIdConsignmentPanel.sending'),
                      }}
                      onClick={() => setConfirmDispatch('uncounted')}
                      disabled={dispatch.isPending}
                    />
                  </Actions>
                </Stack>
              ) : (
                <Note>
                  {t('warehouseConsignmentsIdConsignmentPanel.thereIsNoBangladeshIntake')}
                </Note>
              )}
            </Step>
          )}

          <Step
            n={viaBd ? 5 : 3}
            id="cns-arrival"
            phase={phaseOf('cns-arrival')}
            title={
              viaBd
                ? t('warehouseConsignmentsIdConsignmentPanel.arrivalInIndia')
                : t('warehouseConsignmentsIdConsignmentPanel.arrival')
            }
            state={
              finalLegs.length === 0
                ? t('warehouseConsignmentsIdConsignmentPanel.nothingHasArrivedYet')
                : `${finalLegs.filter((l) => l.status === 'COMPLETED').length} of ${finalLegs.length} shipment(s) counted`
            }
          >
            <Stack>
              {finalLegs.length === 0 ? (
                <Note>—</Note>
              ) : (
                finalLegs.map((leg) => (
                  <div key={leg.id} className="cns-leg">
                    <div className="cns-leg__head">
                      <Code>{leg.receiptNumber}</Code>
                      <span className="stk-sub">
                        {leg.dispatchedAt === null
                          ? t('warehouseConsignmentsIdConsignmentPanel.shippedDirectByTheClient')
                          : t('warehouseConsignmentsIdConsignmentPanel.leftBangladesh', {
                              value: dt(leg.dispatchedAt),
                            })}
                        {leg.receivedAt === null
                          ? ''
                          : t('warehouseConsignmentsIdConsignmentPanel.counted', {
                              value: dt(leg.receivedAt),
                            })}
                      </span>
                    </div>
                    <LegLines
                      leg={leg}
                      shortWord={
                        leg.dispatchedAt === null
                          ? t('warehouseConsignmentsIdConsignmentPanel.shortOfDeclared')
                          : t('warehouseConsignmentsIdConsignmentPanel.lostInTransit')
                      }
                      overWord={
                        leg.dispatchedAt === null
                          ? t('warehouseConsignmentsIdConsignmentPanel.overDeclared')
                          : t('warehouseConsignmentsIdConsignmentPanel.moreThanWasSent')
                      }
                    />
                    {leg.status !== 'COMPLETED' && (
                      <p className="stk-note">
                        <TextLink href={`/warehouse/receive/${leg.id}`}>
                          {t('warehouseConsignmentsIdConsignmentPanel.countItOnTheReceive')}
                        </TextLink>
                      </p>
                    )}
                  </div>
                ))
              )}
            </Stack>
          </Step>
        </div>
      </Panel>

      <Panel title={t('warehouseConsignmentsIdConsignmentPanel.timeline')}>
        {events.isLoading ? (
          <SkeletonRows rows={3} cols={2} />
        ) : eventRows.length === 0 ? (
          <Note>{t('warehouseConsignmentsIdConsignmentPanel.nothingRecordedYet')}</Note>
        ) : (
          <Timeline
            label={t('warehouseConsignmentsIdConsignmentPanel.consignmentHistory')}
            steps={eventRows.map((e) => ({
              id: e.id,
              label: e.description ?? e.type,
              state: 'done' as const,
              time: dt(e.createdAt),
            }))}
          />
        )}
      </Panel>

      {sheet !== null && <LabelSheetView sheet={sheet} onClose={() => setSheet(null)} />}

      <ConfirmDialog
        open={confirmDispatch !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmDispatch(null);
        }}
        title={
          confirmDispatch === 'uncounted'
            ? t('warehouseConsignmentsIdConsignmentPanel.sendItOnWithoutCounting')
            : t('warehouseConsignmentsIdConsignmentPanel.sendToIndia2')
        }
        entity={c.consignmentNumber}
        entityIsIdentifier
        amount={
          confirmDispatch === 'uncounted'
            ? t('warehouseConsignmentsIdConsignmentPanel.declaredUnitSIndia', { declaredUnits })
            : t('warehouseConsignmentsIdConsignmentPanel.unitSIndia', { dispatchUnits })
        }
        consequence={
          confirmDispatch === 'uncounted'
            ? t('warehouseConsignmentsIdConsignmentPanel.itLeavesBangladeshUnopenedOn')
            : t('warehouseConsignmentsIdConsignmentPanel.theUnitsLeaveTheBangladesh')
        }
        confirmLabel={
          confirmDispatch === 'uncounted'
            ? t('warehouseConsignmentsIdConsignmentPanel.sendOnWithoutCounting')
            : t('warehouseConsignmentsIdConsignmentPanel.sendToIndia')
        }
        onConfirm={async () => {
          if (confirmDispatch === 'uncounted') await onForwardUncounted();
          else await onDispatch();
        }}
      />

      <Dialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        tone="critical"
        icon={<Ban size={18} />}
        title={t('warehouseConsignmentsIdConsignmentPanel.cancel2', {
          consignmentNumber: c.consignmentNumber,
        })}
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              {t('warehouseConsignmentsIdConsignmentPanel.keepIt')}
            </Button>
            <AsyncButton
              variant="destructive"
              state={mutationPhase(cancel)}
              labels={{
                idle: t('warehouseConsignmentsIdConsignmentPanel.cancelAndReturnTheGoods'),
                busy: t('warehouseConsignmentsIdConsignmentPanel.cancelling'),
              }}
              onClick={() => void onCancel()}
              disabled={cancel.isPending || reason.trim().length < 10}
            />
          </DialogFooter>
        }
      >
        <Stack>
          <p className="cns-entity">
            <Code>{c.consignmentNumber}</Code> · {c.seller.companyName}
          </p>
          <Note>{t('warehouseConsignmentsIdConsignmentPanel.stockAlreadyBookedInWill')}</Note>
          <TextField
            label={t('warehouseConsignmentsIdConsignmentPanel.why')}
            requiredMark
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('warehouseConsignmentsIdConsignmentPanel.atLeast10CharactersRecorded')}
          />
        </Stack>
      </Dialog>
    </AreaPage>
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
    <div className="cns-leglines">
      {leg.lines.map((l) => (
        <div key={l.id} className="cns-legline">
          <Code>{l.variant.skuCode}</Code>
          <span className="stk-muted cns-legline__name">
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
      {leg.discrepancyNotes !== null && <p className="stk-sub">{leg.discrepancyNotes}</p>}
    </div>
  );
}

const FREIGHT_SOURCE_LABEL = (
  t: Translate<MessageKey>,
): Record<'CONSIGNMENT' | 'SELLER' | 'SYSTEM_DEFAULT', string> => ({
  CONSIGNMENT: t('warehouseConsignmentsIdConsignmentPanel.pinnedOnThisConsignment'),
  SELLER: t('warehouseConsignmentsIdConsignmentPanel.fromTheClientSSettings'),
  SYSTEM_DEFAULT: t('warehouseConsignmentsIdConsignmentPanel.thePlatformDefault'),
});

/**
 * The mode's NAME, for a toast.
 *
 * Was the explaining sentence cut on its first em-dash, which made the
 * long label load-bearing for the short one: reword the explainer and
 * the toast silently changes with it, or loses its text entirely if the
 * dash ever goes.
 */
function shortMode(mode: InboundFreightMode): string {
  return freightModeWords(mode, 'STAFF');
}

/**
 * How THIS consignment's inbound freight is paid for.
 *
 * Three levels resolve it — this consignment's own pin, else the
 * seller's setting, else the platform default — and only the server
 * walks that chain, so the control READS the answer rather than
 * reconstructing it from `inboundFreightMode`, which is null on most
 * consignments and would then read as "pay now" for all of them.
 *
 * The choice belongs here rather than on the freight screen because it
 * decides WHICH STOP carries the bill, and on pay-in-advance that stop
 * is the count happening on this page.
 *
 * FE-2: gated cosmetically on `money.freight.manage` and disabled once
 * a bill exists; the server refuses both regardless
 * (`FREIGHT_MODE_LOCKED`) and its verdict is shown verbatim.
 */
function FreightModeControl({ id }: { readonly id: string }): ReactElement {
  const t = useT();
  const toast = useToast();
  const mayManage = usePermission('money.freight.manage');
  const q = useConsignmentFreightMode(id);
  const setMode = useSetConsignmentFreightMode();
  const [error, setError] = useState<string | null>(null);

  async function onChange(value: string): Promise<void> {
    setError(null);
    try {
      // The empty option CLEARS the pin — it does not mean "no mode".
      // Whatever is in force then comes from the seller or the default
      // again, which is the point of being able to un-pin at all.
      const next = value === '' ? null : (value as InboundFreightMode);
      const result = await setMode.mutateAsync({ id, mode: next });
      toast.success(
        next === null
          ? t('warehouseConsignmentsIdConsignmentPanel.pinClearedApplies', {
              value: shortMode(result.mode),
              value2: FREIGHT_SOURCE_LABEL(t)[result.source],
            })
          : t('warehouseConsignmentsIdConsignmentPanel.freightPinnedTo', {
              value: shortMode(result.mode),
            }),
      );
    } catch (e) {
      setError(serverVerdict(e));
    }
  }

  if (q.data === undefined) return <></>;
  const { mode, source, locked } = q.data;

  return (
    <div className="cns-freight">
      <div>
        <div className="cns-freight__title">
          {t('warehouseConsignmentsIdConsignmentPanel.freight')}
        </div>
        <p className="stk-note">
          {freightModeExplainer(mode, 'STAFF')} — {FREIGHT_SOURCE_LABEL(t)[source]}.
          {locked ? t('warehouseConsignmentsIdConsignmentPanel.aBillAlreadyExistsSo') : ''}
        </p>
      </div>
      {mayManage && (
        <Select
          aria-label={t('warehouseConsignmentsIdConsignmentPanel.howThisConsignmentSFreight')}
          className="cns-freight__select"
          value={source === 'CONSIGNMENT' ? mode : ''}
          disabled={locked || setMode.isPending}
          onChange={(e) => void onChange(e.target.value)}
        >
          <option value="">
            {t('warehouseConsignmentsIdConsignmentPanel.followTheClientSSetting')}
          </option>
          {FREIGHT_MODES.map((m) => (
            <option key={m} value={m}>
              {freightModeExplainer(m, 'STAFF')}
            </option>
          ))}
        </Select>
      )}
      {error !== null && <InlineError message={error} />}
    </div>
  );
}
