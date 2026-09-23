'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Boxes,
  ClipboardPen,
  PackageCheck,
  Plane,
  Receipt,
  TriangleAlert,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import type {
  ConsignmentEventView,
  ConsignmentLegView,
  ConsignmentView,
} from '@skydrop/api-client';
import { ConsignmentStatus } from '@skydrop/db';
import { Money, Num } from '@skydrop/ui/components';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { Table, TableEmpty, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { KpiCard } from '@skydrop/ui/app/kpi-card';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { TextArea } from '@skydrop/ui/app/text-field';
import { Timeline, type TimelineStep } from '@skydrop/ui/app/timeline';
import { useToast } from '@skydrop/ui/app/toast';
import { GlossaryTerm } from '@skydrop/ui/app/tooltip-card';
import {
  AreaPage,
  AreaSection,
  BackLink,
  Dash,
  Facts,
  InlineError,
  KpiGrid,
  MetaFact,
  MetaFacts,
  Note,
  Panel,
  mutationPhase,
  rawCount,
} from '@/app/(authed)/inventory/_components/stock-ui';
import {
  consignmentStatusKind,
  freightModeExplainer,
  inboundFreightStatusKind,
  statusLabel,
} from '@skydrop/ui/status';
import { useCancelConsignment, useConsignment, useConsignmentEvents } from '@/lib/account-hooks';
import { useSellerFreight } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';
import { EditReceiptPanel } from '../../_components/edit-receipt-panel';
import {
  cancellable,
  countingInProgress,
  legProgress,
  countedUnits,
  declaredUnits,
  eventWords,
  indiaLegs,
  legTitle,
  lineLabel,
  indiaProgress,
  productCount,
  routeWords,
  shortDate,
  stamp,
  statusWords,
} from '../../_components/consignment-words';

/** The server's floor for a cancellation reason. Cosmetic — it refuses
 *  a short one regardless, and that refusal is shown verbatim. */
const MIN_REASON = 10;

/**
 * One consignment, followed.
 *
 * This is the screen the founder asked for: a seller who has put goods
 * on a truck in Dhaka wants to know where they are, and until now got
 * one status word in a list and two emails. The TIMELINE is the point of
 * the page — everything else is context for it.
 *
 * The legs are labelled by what they MEAN rather than by their enum: a
 * seller does not know what `BD_INTAKE` is, and the difference between
 * "counted in Dhaka" and "arrived in India" is the whole reason two
 * counts exist.
 */
export function ConsignmentDetailView({ id }: { id: string }): ReactElement {
  const detail = useConsignment(id);

  return (
    <AreaPage>
      <BackLink href="/inbound">
        <ArrowLeft size={14} /> Add stock
      </BackLink>

      {detail.isLoading ? (
        <SkeletonRows rows={6} label="Loading consignment…" />
      ) : detail.isError ? (
        <ErrorState message={serverVerdict(detail.error)} retry={() => void detail.refetch()} />
      ) : detail.data === undefined ? (
        <ErrorState message="Consignment not found." />
      ) : (
        <ConsignmentBody consignment={detail.data} />
      )}
    </AreaPage>
  );
}

/**
 * The loaded consignment.
 *
 * A separate component rather than a branch inside the fetch wrapper:
 * `detail.data` is a mutable property, so TypeScript drops its narrowing
 * inside every callback — including the `.map()` that renders the legs.
 * Passing it in once makes it a non-null parameter for the whole subtree.
 */
function ConsignmentBody({ consignment }: { consignment: ConsignmentView }): ReactElement {
  const events = useConsignmentEvents(consignment.id);
  const canManage = can(useSellerIdentity(), 'inbound.manage');
  const [cancelOpen, setCancelOpen] = useState(false);
  /** A PENDING leg is still a correctable declaration — nothing has been
   *  counted against it yet. The panel refuses anything else itself. */
  const [correcting, setCorrecting] = useState<ConsignmentLegView | null>(null);
  const progress = indiaProgress(consignment);

  const billed = consignment.freightCharges.length > 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Seller console' },
          { label: 'Stock' },
          { label: 'Add stock', href: '/inbound' },
          { label: consignment.consignmentNumber },
        ]}
        Link={Link}
        title={<span className="sk-ident">{consignment.consignmentNumber}</span>}
        subtitle={routeWords(consignment.route).blurb}
        meta={
          <MetaFacts>
            <MetaFact tone="accent">{routeWords(consignment.route).title}</MetaFact>
            <MetaFact dot>{statusWords(consignment.status)}</MetaFact>
            {consignment.sellerReference !== null && (
              <MetaFact>Your ref {consignment.sellerReference}</MetaFact>
            )}
          </MetaFacts>
        }
        action={
          canManage && cancellable(consignment) ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<XCircle size={14} />}
              onClick={() => setCancelOpen(true)}
            >
              Cancel consignment
            </Button>
          ) : undefined
        }
      />

      {/* Where the goods actually are, in units. The status chip above
          says "at our Dhaka warehouse", which is true and does not say
          how much — a consignment part flown and part waiting looks
          identical to one nobody has touched. `progress` is null until
          there is an India leg to measure against, and a tile is left
          out rather than shown as zero. */}
      <KpiGrid>
        <KpiCard
          label="Products declared"
          icon={<Boxes size={14} />}
          value={productCount(consignment)}
          format={rawCount}
          unit="SKUs"
          tone="neutral"
          // `shortDate(null)` is an em dash, so the unguarded form read
          // "Expected —." on every consignment declared without a date.
          {...(consignment.expectedArrivalAt === null
            ? {}
            : { hint: `Expected ${shortDate(consignment.expectedArrivalAt)}.` })}
        />
        {progress !== null && (
          <>
            <KpiCard
              label="Received in India"
              icon={<PackageCheck size={14} />}
              value={progress.receivedInIndia}
              format={rawCount}
              unit="units"
              tone={
                progress.receivedInIndia > 0 && progress.stillToCome === 0 ? 'credit' : 'neutral'
              }
              // Nothing counted yet is NOT "all of it has landed", and
              // it is not "on the shelf and sellable" either — a
              // cancelled or still-announced consignment reads 0 here.
              hint={
                progress.receivedInIndia === 0
                  ? 'Nothing has been counted in India yet.'
                  : progress.stillToCome === 0
                    ? 'All of it has landed and been counted.'
                    : 'On the shelf and sellable.'
              }
            />
            <KpiCard
              label={
                <GlossaryTerm
                  title="Still to come"
                  icon={<Plane size={16} />}
                  description="Units declared on this consignment that have not been counted in India yet — waiting in Dhaka or in the air. They are not sellable until they land."
                >
                  Still to come
                </GlossaryTerm>
              }
              icon={<Plane size={14} />}
              value={progress.stillToCome}
              format={rawCount}
              unit="units"
              tone={progress.stillToCome > 0 ? 'pending' : 'neutral'}
              hint="In Dhaka or in the air — not sellable yet."
            />
          </>
        )}
        <KpiCard
          label="Inbound freight"
          icon={<Wallet size={14} />}
          figure={
            !billed ? (
              <span className="inv-faint">Not billed</span>
            ) : (
              <Money
                amount={consignment.freightCharges
                  .reduce((sum, f) => sum + Number(f.totalInr), 0)
                  .toFixed(2)}
              />
            )
          }
          tone="neutral"
          // Billed per ARRIVAL: a consignment that lands in two shipments
          // carries two forwarder invoices, so the seller sees the sum
          // rather than one of them.
          hint={
            consignment.freightCharges.length === 0
              ? 'Nothing has been billed against this yet.'
              : consignment.freightCharges.length === 1
                ? `One bill · ${consignment.freightCharges[0]?.status.toLowerCase()}`
                : `${consignment.freightCharges.length} bills, one per arrival`
          }
        />
      </KpiGrid>

      <AreaSection title="Consignment" note="The facts we hold about it.">
        <Panel>
          <div className="inv-stack">
            <Facts
              columns={3}
              items={[
                {
                  label: 'Where it is',
                  value: (
                    <StatusChip
                      kind={consignmentStatusKind(consignment.status)}
                      label={statusWords(consignment.status)}
                      size="sm"
                    />
                  ),
                },
                { label: 'Route', value: routeWords(consignment.route).title },
                { label: 'Expected arrival', value: shortDate(consignment.expectedArrivalAt) },
                {
                  label: 'Your reference',
                  value: consignment.sellerReference ?? <Dash />,
                },
                { label: 'Products', value: <Num value={productCount(consignment)} /> },
                ...(progress === null
                  ? []
                  : [
                      {
                        label: 'Received in India',
                        value: <Num value={progress.receivedInIndia} />,
                      },
                      {
                        label: 'Still to come',
                        value: (
                          <span className="inv-baseline">
                            <Num value={progress.stillToCome} />
                            <span className="inv-sub">in Dhaka or in the air</span>
                          </span>
                        ),
                      },
                    ]),
              ]}
            />
            {consignment.cancelReason !== null && (
              <div className="inv-callout" data-tone="warn">
                <XCircle size={16} aria-hidden className="inv-callout__icon" />
                <span>
                  Cancelled {shortDate(consignment.cancelledAt)} — {consignment.cancelReason}
                </span>
              </div>
            )}
          </div>
        </Panel>
      </AreaSection>

      <AreaSection
        title="What has happened"
        note="Oldest first. Added as it happens — you do not need to ask."
      >
        <Panel>
          {events.isLoading ? (
            <SkeletonRows rows={3} label="Loading timeline…" />
          ) : events.isError ? (
            <ErrorState message={serverVerdict(events.error)} retry={() => void events.refetch()} />
          ) : (
            <EventTimeline events={events.data ?? []} consignment={consignment} />
          )}
        </Panel>
      </AreaSection>

      {consignment.receipts.length === 0 ? (
        <AreaSection title="Each stop" note="What was declared, and what the warehouse counted.">
          <Panel>
            <Note>Nothing has been set up to receive this yet.</Note>
          </Panel>
        </AreaSection>
      ) : (
        // Each stop is its own section, read in order — the journey's
        // stops ARE its order, so no numbering is needed to say so.
        consignment.receipts.map((leg) => (
          <LegCard
            key={leg.id}
            leg={leg}
            consignment={consignment}
            canManage={canManage}
            onCorrect={() => setCorrecting(leg)}
          />
        ))
      )}

      <AreaSection
        title="Inbound freight"
        note="What it cost to move this consignment, and how much of that has been charged so far."
      >
        <ConsignmentFreight consignmentId={consignment.id} />
      </AreaSection>

      <CancelConsignmentModal
        open={cancelOpen}
        consignment={consignment}
        onClose={() => setCancelOpen(false)}
      />
      <EditReceiptPanel receipt={correcting} onClose={() => setCorrecting(null)} />
    </>
  );
}

/**
 * The timeline. Oldest first, exactly as the server returned it — the
 * ordering is the server's fact, and re-sorting here is how the page
 * ends up disagreeing with the email that announced the same event.
 */
function EventTimeline({
  events,
  consignment,
}: {
  events: readonly ConsignmentEventView[];
  consignment: ConsignmentView;
}): ReactElement {
  if (events.length === 0) {
    return (
      <Note>
        Nothing has happened yet beyond announcing it. Steps appear here as the warehouse counts,
        labels, ships and receives.
      </Note>
    );
  }
  // Every event HAS happened, so each is done; the latest is the current
  // step while the consignment is still moving, and done once it has
  // finished or been called off. The words are the event's own.
  const ended =
    consignment.status === ConsignmentStatus.COMPLETED ||
    consignment.status === ConsignmentStatus.CANCELLED;
  const steps = events.map((evt, i): TimelineStep => {
    const last = i === events.length - 1;
    return {
      id: evt.id,
      label: eventWords(evt.type),
      state: last && !ended ? 'current' : 'done',
      ...(last && consignment.status === ConsignmentStatus.CANCELLED
        ? { tone: 'failed' as const }
        : {}),
      description: evt.description ?? undefined,
      time: <span className="sk-figure">{stamp(evt.createdAt)}</span>,
    };
  });
  return (
    <Timeline
      label={`What has happened to ${consignment.consignmentNumber}`}
      steps={steps}
      collapseEarlier={{
        keep: 4,
        showLabel: 'Show {n} earlier steps',
        hideLabel: 'Hide the earlier steps',
      }}
    />
  );
}

/**
 * One stop on the journey.
 *
 * `dispatchedAt` being set is the fact that matters most on an India
 * leg: it means those units have LEFT Bangladesh, which is also the
 * moment cancelling stops being possible.
 */
function LegCard({
  leg,
  consignment,
  canManage,
  onCorrect,
}: {
  readonly leg: ConsignmentLegView;
  readonly consignment: ConsignmentView;
  readonly canManage: boolean;
  readonly onCorrect: () => void;
}): ReactElement {
  const counted = countedUnits(leg);
  const declared = declaredUnits(leg);
  /**
   * NOT COUNTED is not the same as COUNTED ZERO, and `receivedQty`
   * cannot tell them apart — it defaults to 0 on a line nobody has
   * touched. Reading it directly told a seller whose consignment had
   * only just been announced that 300 units were missing.
   *
   * The receipt's STATUS is the discriminator: until it is COMPLETED,
   * nothing here has been counted and there is nothing to compare.
   */
  const isCounted = leg.status === 'COMPLETED';
  const counting = countingInProgress(leg);
  const anyVariance = isCounted && leg.lines.some((l) => (l.receivedQty ?? 0) !== l.expectedQty);

  return (
    <AreaSection
      title={
        <span className="inv-leg-heading">
          {legTitle(leg, consignment.route, indiaLegs(consignment))}
          <span className="sk-ident inv-muted">{leg.receiptNumber}</span>
        </span>
      }
      // What is happening here, said plainly. `ARRIVING` means "we
      // have it" and nobody outside a warehouse reads it that way.
      note={
        <>
          {leg.warehouse.name} · {leg.warehouse.countryCode} —{' '}
          <span style={{ color: 'var(--fg-body)' }}>{legProgress(leg).headline}</span>
        </>
      }
      action={
        canManage && leg.status === 'PENDING' ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<ClipboardPen size={14} />}
            onClick={onCorrect}
          >
            Correct contents
          </Button>
        ) : undefined
      }
    >
      <Panel>
        <div className="inv-stack">
          <Note>{legProgress(leg).detail}</Note>
          <Facts
            columns={3}
            items={[
              { label: 'Declared', value: <Num value={declared} suffix="units" /> },
              {
                label: 'Counted',
                value:
                  counted === null ? (
                    <span className="inv-muted">{legProgress(leg).headline}</span>
                  ) : (
                    <Num value={counted} suffix="units" />
                  ),
              },
              {
                label: leg.dispatchedAt !== null ? 'Left Bangladesh' : 'Received',
                value:
                  leg.dispatchedAt !== null
                    ? shortDate(leg.dispatchedAt)
                    : shortDate(leg.receivedAt),
              },
            ]}
          />

          {anyVariance && (
            // Deliberately does NOT print `discrepancyNotes`. That is a
            // stored string written at completion — so a note written
            // before a wording fix keeps its old wording forever, which is
            // how raw variant uuids were still on this page hours after
            // they stopped being generated. The table below already says
            // every line, by name, with the difference; the banner only has
            // to say what it MEANS.
            <div className="inv-callout" data-tone="warn">
              <TriangleAlert size={16} aria-hidden className="inv-callout__icon" />
              <span>
                Some lines were counted differently — the per-product figures are below. Nothing is
                blocked by it: your stock is what was counted. Raise an issue if the difference is
                not yours.
              </span>
            </div>
          )}

          <Table caption={`Counts at ${leg.receiptNumber}`}>
            <THead>
              <Tr>
                <Th>Product</Th>
                <Th align="right">Declared</Th>
                <Th align="right">Counted</Th>
                <Th align="right">Difference</Th>
              </Tr>
            </THead>
            {leg.lines.length === 0 ? (
              <TBody>
                <TableEmpty colSpan={4}>Nothing has been listed against this stop yet.</TableEmpty>
              </TBody>
            ) : (
              <TBody>
                {leg.lines.map((l) => {
                  const diff = isCounted ? (l.receivedQty ?? 0) - l.expectedQty : null;
                  return (
                    <Tr key={l.id}>
                      <Td>
                        <span className="inv-combo__text">
                          <span className="inv-combo__name">{lineLabel(l)}</span>
                          <span className="sk-ident inv-muted">{l.variant.skuCode}</span>
                        </span>
                      </Td>
                      <Td align="right">
                        <Num value={l.expectedQty} />
                      </Td>
                      <Td align="right">
                        {isCounted ? (
                          <Num value={l.receivedQty ?? 0} />
                        ) : counting ? (
                          // Provisional. Shown so a seller can see the
                          // warehouse is working, italic so it does not read
                          // as the final answer, and with no difference
                          // beside it — a variance against a half-finished
                          // count is a shortfall that mostly is not real.
                          <span className="inv-muted" style={{ fontStyle: 'italic' }}>
                            <Num value={l.receivedQty ?? 0} /> so far
                          </span>
                        ) : (
                          <span className="inv-muted">—</span>
                        )}
                      </Td>
                      <Td align="right">
                        {diff === null || diff === 0 ? (
                          <span className="inv-muted">—</span>
                        ) : (
                          // Signed on purpose: a surplus and a shortfall are
                          // different events, and an unsigned "3" hides which.
                          <span className="inv-num" data-tone={diff < 0 ? 'bad' : undefined}>
                            {diff > 0 && '+'}
                            <Num value={diff} />
                          </span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            )}
          </Table>
        </div>
      </Panel>
    </AreaSection>
  );
}

/**
 * Abandoning a consignment sends the goods back to the seller, so it
 * takes a reason and the reason is kept.
 *
 * The window closes at dispatch and the SERVER owns that rule — this
 * modal can be reached on a consignment that was dispatched a second
 * ago, and when it is, `CONSIGNMENT_ALREADY_DISPATCHED` is shown
 * verbatim rather than being guessed at here (FE-2).
 */
function CancelConsignmentModal({
  open,
  consignment,
  onClose,
}: {
  readonly open: boolean;
  readonly consignment: ConsignmentView;
  readonly onClose: () => void;
}): ReactElement {
  const cancel = useCancelConsignment();
  const toast = useToast();
  const [reason, setReason] = useState('');

  function close(): void {
    setReason('');
    cancel.reset();
    onClose();
  }

  function submitCancel(): void {
    cancel.mutate(
      { id: consignment.id, reason: reason.trim() },
      {
        onSuccess: (res) => {
          toast.success(
            `${consignment.consignmentNumber} cancelled — ${res.unitsReturned} units returned to you`,
          );
          close();
        },
      },
    );
  }

  // It already asked; it now RESTATES what it acts on — the consignment
  // number, its route and how many products — above the consequence, so
  // nobody confirms without seeing which shipment they are calling off.
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      tone="critical"
      icon={<TriangleAlert size={18} />}
      size="sm"
      locked={cancel.isPending}
      title={`Cancel ${consignment.consignmentNumber}?`}
      description="The goods come back to you and anything already counted is taken off your stock. Only possible before the consignment leaves for India."
      footer={
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={close} disabled={cancel.isPending}>
            Keep it
          </Button>
          <AsyncButton
            variant="destructive"
            size="md"
            labels={{ idle: 'Cancel consignment', busy: 'Cancelling…' }}
            state={mutationPhase(cancel)}
            disabled={reason.trim().length < MIN_REASON || cancel.isPending}
            onClick={submitCancel}
          />
        </DialogFooter>
      }
    >
      <div className="inv-stack">
        <div className="inv-callout">
          <span className="sk-ident" style={{ color: 'var(--fg-strong)' }}>
            {consignment.consignmentNumber}
          </span>
          <span>
            {routeWords(consignment.route).title} · {productCount(consignment)}{' '}
            {productCount(consignment) === 1 ? 'product' : 'products'}
          </span>
        </div>
        <TextArea
          label="Why it is coming back"
          id="cn-cancel-reason"
          hint="At least ten characters. Kept on the record permanently."
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        {cancel.error !== null && <InlineError message={serverVerdict(cancel.error)} />}
      </div>
    </Dialog>
  );
}

/**
 * The freight bill(s) for ONE consignment, in the seller's own words.
 *
 * The consignment view carries four fields per bill (id, status, total,
 * receipt) and no `voidedAt`, so a withdrawn bill would still be summed
 * into the header figure. This reads the freight endpoint instead,
 * which already hides a withdrawn bill and carries what the rate was
 * agreed in — the figure the seller actually negotiated on the phone,
 * and the only thing that makes a rupee total checkable.
 *
 * Per-LINE detail (basis, rate, chargeable weight per product) lives
 * only on the admin cost-breakdown endpoint today, so it is not shown;
 * a seller endpoint for it is the next step.
 */
function ConsignmentFreight({ consignmentId }: { readonly consignmentId: string }): ReactElement {
  const q = useSellerFreight({});

  if (q.isLoading) return <SkeletonRows rows={2} label="Loading freight…" />;
  if (q.isError) {
    return <ErrorState message={serverVerdict(q.error)} retry={() => void q.refetch()} />;
  }

  const bills = (q.data?.items ?? []).filter((f) => f.consignmentId === consignmentId);

  if (bills.length === 0) {
    return (
      <Panel>
        <Note>
          Nothing billed yet. A freight bill appears here once we have the forwarder&apos;s figure
          for this consignment — on pay-in-advance terms that is after the Dhaka count, otherwise
          after it lands in India.
        </Note>
      </Panel>
    );
  }

  return (
    <div className="inv-stack">
      {bills.map((f) => (
        <Panel key={f.id}>
          <div className="inv-stack">
            <div className="inv-leg-head">
              <h3 className="inv-leg-title">
                <Receipt size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />
                {f.receiptNumber ?? 'Freight bill'}
              </h3>
              <StatusChip
                kind={inboundFreightStatusKind(f.status)}
                label={statusLabel(f.status)}
                size="sm"
              />
            </div>
            <Facts
              columns={3}
              items={[
                {
                  label: 'Total',
                  value: (
                    <span className="inv-combo__text">
                      <Money amount={f.totalInr} />
                      {/* The figure agreed with us, when that was not in
                          rupees. The rupees are what leaves the wallet;
                          this is what the conversation was about, and
                          without it the total cannot be checked. */}
                      {f.agreedCurrency !== 'INR' && (
                        <span className="inv-sub">
                          <Money
                            amount={f.agreedAmount}
                            currency={f.agreedCurrency}
                            convert={false}
                          />{' '}
                          agreed, converted at the rate when it was billed
                        </span>
                      )}
                    </span>
                  ),
                },
                { label: 'Charged so far', value: <Money amount={f.amountSettledInr} /> },
                {
                  label: 'Still to come',
                  value:
                    Number(f.outstandingInr) === 0 ? (
                      <span className="inv-muted">Nothing</span>
                    ) : (
                      <Money amount={f.outstandingInr} direction="debit" />
                    ),
                },
                { label: 'Terms', value: freightModeExplainer(f.mode, 'SELLER') },
                {
                  label: 'Units charged',
                  value: (
                    <span className="inv-baseline">
                      <Num value={f.unitsSettled} /> <span>of</span> <Num value={f.totalUnits} />
                    </span>
                  ),
                },
                {
                  label: 'Service charge',
                  value:
                    f.serviceChargeInr === null || Number(f.serviceChargeInr) === 0 ? (
                      <span className="inv-muted">None</span>
                    ) : (
                      <Money amount={f.serviceChargeInr} />
                    ),
                },
              ]}
            />
            {f.note !== null && <Note>{f.note}</Note>}
          </div>
        </Panel>
      ))}
    </div>
  );
}
