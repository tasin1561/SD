'use client';

import Link from 'next/link';
import { ArrowLeft, Boxes, PackageCheck, Plane, Wallet, XCircle } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import type {
  ConsignmentEventView,
  ConsignmentLegView,
  ConsignmentView,
} from '@skydrop/api-client';
import {
  BandBody,
  Button,
  Crumbs,
  DescriptionList,
  ErrorNote,
  ErrorState,
  FormField,
  LoadingState,
  MetaChip,
  Modal,
  ModalFooter,
  Money,
  Num,
  PageHeader,
  SectionBand,
  Stat,
  StatusBadge,
  TBody,
  Table,
  TableEmpty,
  Td,
  THead,
  Th,
  Textarea,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { consignmentStatusKind } from '@skydrop/ui/status';
import { useCancelConsignment, useConsignment, useConsignmentEvents } from '@/lib/account-hooks';
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
    <div>
      <Link
        href="/inbound"
        className="text-text-muted hover:text-text-bright mb-3 inline-flex items-center gap-1.5 text-xs transition-colors"
      >
        <ArrowLeft size={13} /> Add stock
      </Link>

      {detail.isLoading ? (
        <LoadingState label="Loading consignment…" />
      ) : detail.isError ? (
        <ErrorState message={serverVerdict(detail.error)} retry={() => void detail.refetch()} />
      ) : detail.data === undefined ? (
        <ErrorState message="Consignment not found." />
      ) : (
        <ConsignmentBody consignment={detail.data} />
      )}
    </div>
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

  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: 'Seller console' },
              { label: 'Stock' },
              { label: 'Add stock', href: '/inbound' },
              { label: consignment.consignmentNumber },
            ]}
            Link={Link}
          />
        }
        title={<span className="font-mono">{consignment.consignmentNumber}</span>}
        subtitle={routeWords(consignment.route).blurb}
        meta={
          <>
            <MetaChip tone="accent">{routeWords(consignment.route).title}</MetaChip>
            <MetaChip dot>{statusWords(consignment.status)}</MetaChip>
            {consignment.sellerReference !== null && (
              <MetaChip>Your ref {consignment.sellerReference}</MetaChip>
            )}
          </>
        }
        action={
          canManage && cancellable(consignment) ? (
            <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>
              <XCircle size={12} /> Cancel consignment
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
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Products declared"
          icon={<Boxes size={13} aria-hidden />}
          value={productCount(consignment)}
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
            <Stat
              label="Received in India"
              icon={<PackageCheck size={13} aria-hidden />}
              value={progress.receivedInIndia}
              unit="units"
              tone={progress.receivedInIndia > 0 && progress.stillToCome === 0 ? 'good' : 'neutral'}
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
            <Stat
              label="Still to come"
              icon={<Plane size={13} aria-hidden />}
              value={progress.stillToCome}
              unit="units"
              tone={progress.stillToCome > 0 ? 'warn' : 'neutral'}
              hint="In Dhaka or in the air — not sellable yet."
            />
          </>
        )}
        <Stat
          label="Inbound freight"
          icon={<Wallet size={13} aria-hidden />}
          value={
            consignment.freightCharges.length === 0 ? (
              <span className="text-text-faint text-base">Not billed</span>
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
      </div>

      <div className="mb-4">
        <SectionBand index="01" title="Consignment" note="The facts we hold about it." />
        <BandBody>
          <DescriptionList
            columns={3}
            items={[
              {
                label: 'Where it is',
                value: (
                  <StatusBadge
                    kind={consignmentStatusKind(consignment.status)}
                    label={statusWords(consignment.status)}
                  />
                ),
              },
              { label: 'Route', value: routeWords(consignment.route).title },
              { label: 'Expected arrival', value: shortDate(consignment.expectedArrivalAt) },
              {
                label: 'Your reference',
                value: consignment.sellerReference ?? <span className="text-text-faint">—</span>,
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
                        <span className="flex items-baseline gap-2">
                          <Num value={progress.stillToCome} />
                          <span className="text-text-muted text-xs">in Dhaka or in the air</span>
                        </span>
                      ),
                    },
                  ]),
            ]}
          />
          {consignment.cancelReason !== null && (
            <p className="text-text-muted border-border mt-3 border-t pt-3 text-sm">
              Cancelled {shortDate(consignment.cancelledAt)} — {consignment.cancelReason}
            </p>
          )}
        </BandBody>
      </div>

      <div className="mb-4">
        <SectionBand
          index="02"
          title="What has happened"
          note="Oldest first. Added as it happens — you do not need to ask."
        />
        <BandBody flush={!events.isLoading && !events.isError && (events.data ?? []).length > 0}>
          {events.isLoading ? (
            <LoadingState label="Loading timeline…" rows={3} />
          ) : events.isError ? (
            <ErrorState message={serverVerdict(events.error)} retry={() => void events.refetch()} />
          ) : (
            <Timeline events={events.data ?? []} />
          )}
        </BandBody>
      </div>

      {consignment.receipts.length === 0 ? (
        <div>
          <SectionBand
            index="03"
            title="Each stop"
            note="What was declared, and what the warehouse counted."
          />
          <BandBody>
            <p className="text-text-muted text-sm">Nothing has been set up to receive this yet.</p>
          </BandBody>
        </div>
      ) : (
        // Each stop is its own NUMBERED region rather than a card inside
        // one — the stops are read in order and the numbers are what say
        // so, and a bordered card nested inside a bordered band body
        // draws two lines a hair apart.
        consignment.receipts.map((leg, i) => (
          <LegCard
            key={leg.id}
            index={String(i + 3).padStart(2, '0')}
            leg={leg}
            consignment={consignment}
            canManage={canManage}
            onCorrect={() => setCorrecting(leg)}
          />
        ))
      )}

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
function Timeline({ events }: { events: readonly ConsignmentEventView[] }): ReactElement {
  if (events.length === 0) {
    return (
      <p className="text-text-muted text-sm">
        Nothing has happened yet beyond announcing it. Steps appear here as the warehouse counts,
        labels, ships and receives.
      </p>
    );
  }
  return (
    <ol className="divide-border divide-y">
      {events.map((evt) => (
        // The stamp stacks ABOVE the wording on a phone rather than
        // taking a fixed 10rem column out of a 360px screen, which left
        // the description a word wide.
        <li key={evt.id} className="flex flex-col gap-0.5 px-3 py-3 sm:flex-row sm:gap-4">
          <div className="text-text-faint shrink-0 font-mono text-xs sm:w-40 sm:pt-0.5">
            {stamp(evt.createdAt)}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="text-text-strong text-sm font-medium">{eventWords(evt.type)}</div>
            {evt.description !== null && (
              <div className="text-text-muted text-sm">{evt.description}</div>
            )}
          </div>
        </li>
      ))}
    </ol>
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
  index,
  leg,
  consignment,
  canManage,
  onCorrect,
}: {
  /** Its place in the journey — "03", "04". The stops are read in order. */
  readonly index: string;
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
    <div className="mb-4">
      <SectionBand
        index={index}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {legTitle(leg, consignment.route, indiaLegs(consignment))}
            <span className="text-text-muted font-mono text-[11px] normal-case">
              {leg.receiptNumber}
            </span>
          </span>
        }
        // What is happening here, said plainly. `ARRIVING` means "we
        // have it" and nobody outside a warehouse reads it that way.
        note={
          <>
            {leg.warehouse.name} · {leg.warehouse.countryCode} —{' '}
            <span className="text-text-body">{legProgress(leg).headline}</span>
          </>
        }
        action={
          canManage && leg.status === 'PENDING' ? (
            <Button variant="secondary" size="sm" onClick={onCorrect}>
              Correct contents
            </Button>
          ) : undefined
        }
      />
      <BandBody>
        <p className="text-text-faint mb-3 text-xs">{legProgress(leg).detail}</p>
        <DescriptionList
          columns={3}
          items={[
            { label: 'Declared', value: <Num value={declared} suffix="units" /> },
            {
              label: 'Counted',
              value:
                counted === null ? (
                  <span className="text-text-muted">{legProgress(leg).headline}</span>
                ) : (
                  <Num value={counted} suffix="units" />
                ),
            },
            {
              label: leg.dispatchedAt !== null ? 'Left Bangladesh' : 'Received',
              value:
                leg.dispatchedAt !== null ? shortDate(leg.dispatchedAt) : shortDate(leg.receivedAt),
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
          <p className="text-critical mt-3 rounded-[5px] border border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] px-3 py-2 text-xs">
            Some lines were counted differently — the per-product figures are below. Nothing is
            blocked by it: your stock is what was counted. Raise an issue if the difference is not
            yours.
          </p>
        )}

        <Table wrapperClassName="mt-3">
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
                      <span className="flex min-w-0 flex-col">
                        <span className="text-text-body truncate text-sm">{lineLabel(l)}</span>
                        <span className="text-text-muted font-mono text-xs">
                          {l.variant.skuCode}
                        </span>
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
                        <span className="text-text-muted italic">
                          <Num value={l.receivedQty ?? 0} /> so far
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </Td>
                    <Td align="right">
                      {diff === null || diff === 0 ? (
                        <span className="text-text-muted">—</span>
                      ) : (
                        // Signed on purpose: a surplus and a shortfall are
                        // different events, and an unsigned "3" hides which.
                        <span className={diff < 0 ? 'text-critical' : 'text-text-strong'}>
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
      </BandBody>
    </div>
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

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={`Cancel ${consignment.consignmentNumber}?`}
      description="The goods come back to you and anything already counted is taken off your stock. Only possible before the consignment leaves for India."
    >
      <FormField
        label="Why it is coming back"
        htmlFor="cn-cancel-reason"
        hint="At least ten characters. Kept on the record permanently."
      >
        <Textarea
          id="cn-cancel-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </FormField>

      {cancel.error !== null && <ErrorNote message={serverVerdict(cancel.error)} />}

      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close}>
          Keep it
        </Button>
        <Button
          variant="destructive"
          size="md"
          disabled={reason.trim().length < MIN_REASON || cancel.isPending}
          onClick={() =>
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
            )
          }
        >
          {cancel.isPending ? 'Cancelling…' : 'Cancel consignment'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
