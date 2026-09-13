import { RtoDisposition, RtoItemCondition } from '@skydrop/db';

/**
 * What we tell a seller when a returned item is not right.
 *
 * A scrap/damage ticket is opened by US, off an RTO inspection, and the
 * seller finds it on their ticket list. It used to open with the
 * inspector's notes and nothing else — so, with no notes, the seller saw
 * "Nothing said yet." on a ticket about their own goods, with no product,
 * no quantity and no idea what we meant to do about it. The facts are all
 * on the shipment line at the moment of inspection; this writes them down.
 *
 * PURE: no Prisma, no clock. The caller gathers the facts; the words live
 * here once. The backfill migration
 * (`20260913000300_scrap_ticket_opening_messages`) restates the opening
 * message in SQL for the tickets opened before this existed — a one-off,
 * so if this wording changes that migration is NOT expected to follow.
 *
 * Only facts. No refund figure is ever written here: none is known until
 * somebody has reviewed the damage, and a number we then do not pay is
 * worse than no number.
 */
export interface ScrapTicketFacts {
  readonly productName: string;
  readonly skuCode: string;
  /** The returned line's quantity (`shipment_items.quantity`). */
  readonly quantity: number;
  readonly condition: RtoItemCondition;
  readonly disposition: RtoDisposition | null;
  readonly orderNumber: string | null;
  readonly shipmentNumber: string | null;
  readonly awbNumber: string | null;
  /** When it came back to us (`shipments.rto_received_at`). */
  readonly receivedAt: Date | null;
  /** Where it came back to — the receiving warehouse, else the origin. */
  readonly receivedWarehouse: {
    readonly code: string;
    readonly name: string;
    readonly timezone: string | null;
  } | null;
  readonly notes: string | null;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * `9 Sep 2026`, in the warehouse's own zone.
 *
 * Built from numeric parts rather than a locale's short month: en-GB
 * spells September "Sept" in current ICU, and Postgres's `Mon` (which
 * the backfill uses) spells it "Sep" — the two would disagree on one
 * month a year for no reason anybody would guess.
 */
export function formatReceivedDate(at: Date, timeZone: string | null): string {
  const parts = datePartsIn(at, timeZone ?? DEFAULT_TIMEZONE);
  return `${parts.day} ${MONTHS[parts.month - 1] ?? ''} ${parts.year}`;
}

function datePartsIn(at: Date, timeZone: string): { year: number; month: number; day: number } {
  let formatted: Intl.DateTimeFormatPart[];
  try {
    formatted = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(at);
  } catch {
    // An unrecognised zone name on a warehouse row must not cost the
    // seller their message; fall back to the zone every warehouse uses.
    return datePartsIn(at, DEFAULT_TIMEZONE);
  }
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(formatted.find((p) => p.type === type)?.value ?? 0);
  return { year: read('year'), month: read('month'), day: read('day') };
}

function foundPhrase(condition: RtoItemCondition, again: boolean): string {
  switch (condition) {
    case RtoItemCondition.DAMAGED:
      return 'arrived damaged';
    case RtoItemCondition.MISSING:
      return 'was missing from the returned parcel';
    case RtoItemCondition.GOOD:
      return again ? 'is in good condition after all' : 'is in good condition';
  }
}

function dispositionPhrase(disposition: RtoDisposition): string {
  switch (disposition) {
    case RtoDisposition.RESTOCK:
      return 'putting it back into your sellable stock';
    case RtoDisposition.WRITE_OFF:
      return 'writing it off — it will not go back into your sellable stock';
    case RtoDisposition.INSPECT_LATER:
      return 'holding it aside for a closer look — it stays out of your sellable stock until we decide';
  }
}

function nextStep(condition: RtoItemCondition): string {
  switch (condition) {
    case RtoItemCondition.DAMAGED:
      return 'we review the damage and reply here';
    case RtoItemCondition.MISSING:
      return 'we look into what happened to it and reply here';
    case RtoItemCondition.GOOD:
      return 'we review this and reply here';
  }
}

/** The fact lines both messages share, blanks left out rather than printed as "—". */
function factLines(f: ScrapTicketFacts, again: boolean): string[] {
  const lines: string[] = [
    `${f.productName} (${f.skuCode}), quantity ${f.quantity}: ${foundPhrase(f.condition, again)}.`,
  ];
  const refs = [
    f.orderNumber === null ? null : `Order ${f.orderNumber}`,
    f.shipmentNumber === null ? null : `parcel ${f.shipmentNumber}`,
    f.awbNumber === null ? null : `waybill ${f.awbNumber}`,
  ].filter((r): r is string => r !== null);
  if (refs.length > 0) lines.push(refs.join(' · '));
  if (f.receivedAt !== null) {
    const where =
      f.receivedWarehouse === null
        ? ''
        : ` at ${f.receivedWarehouse.code} (${f.receivedWarehouse.name})`;
    lines.push(
      `Received back on ${formatReceivedDate(f.receivedAt, f.receivedWarehouse?.timezone ?? null)}${where}.`,
    );
  }
  if (f.disposition !== null) {
    lines.push(`What we are doing with it: ${dispositionPhrase(f.disposition)}.`);
  }
  const notes = f.notes?.trim() ?? '';
  if (notes !== '') lines.push(`Inspector's note: "${notes}"`);
  return lines;
}

/**
 * The ticket's opening message — stored as its `description`, which both
 * conversations render first, on OUR side (the ticket says who opened it).
 */
export function scrapTicketOpeningMessage(
  f: ScrapTicketFacts & { readonly ticketNumber: string | null },
): string {
  const header =
    f.ticketNumber === null
      ? 'We opened this ticket for you after inspecting a returned parcel.'
      : `Ticket ${f.ticketNumber} — we opened this for you after inspecting a returned parcel.`;
  const next =
    `What happens next: ${nextStep(f.condition)}. ` +
    'If a refund is due, it is credited to your wallet and shown on this ticket. ' +
    'If you have anything that helps — how the product is normally packaged, or a photo of it new — reply below.';
  return [header, factLines(f, false).join('\n'), next].join('\n\n');
}

/**
 * Said on the ticket when a line is inspected AGAIN and the finding
 * changed. The opening message is never edited (the conversation is a
 * record, TKT-1), so a correction is a new message, in order, with a time.
 */
export function scrapTicketReinspectionNote(f: ScrapTicketFacts): string {
  const next =
    f.condition === RtoItemCondition.GOOD
      ? 'We will look at this ticket again in light of that and reply here.'
      : `What happens next: ${nextStep(f.condition)}.`;
  return [
    'We inspected this item again and updated what we found.',
    factLines(f, true).join('\n'),
    next,
  ].join('\n\n');
}
