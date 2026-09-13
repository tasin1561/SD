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
  /**
   * WMS-8d — the line inspected BY QUANTITY. When the units went more
   * than one way (1 damaged kept aside, 1 good restocked), the message
   * says so unit-group by unit-group, so the seller reads "1 of 2 arrived
   * damaged; the other is going back into your stock" rather than one
   * verdict for both. Absent, or every unit the same, ⇒ the single form
   * above, word for word.
   */
  readonly rows?: readonly ScrapTicketRowFact[];
}

export interface ScrapTicketRowFact {
  readonly quantity: number;
  readonly condition: RtoItemCondition;
  readonly disposition: RtoDisposition;
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
    case RtoDisposition.HOLD_DAMAGED:
      return (
        'keeping it aside for you in our damaged-goods area — it stays out of your sellable stock ' +
        'until you tell us here whether to send it back to you or dispose of it'
      );
  }
}

/** One unit-group of a split line: "1 of 2 arrived damaged". */
function foundPhraseCounted(condition: RtoItemCondition, n: number): string {
  switch (condition) {
    case RtoItemCondition.DAMAGED:
      return 'arrived damaged';
    case RtoItemCondition.MISSING:
      return n === 1
        ? 'was missing from the returned parcel'
        : 'were missing from the returned parcel';
    case RtoItemCondition.GOOD:
      return n === 1 ? 'is in good condition' : 'are in good condition';
  }
}

/** What we do with a unit-group, with the right pronoun for its size. */
function dispositionPhraseCounted(disposition: RtoDisposition, n: number): string {
  const it = n === 1 ? 'it' : 'them';
  switch (disposition) {
    case RtoDisposition.RESTOCK:
      return `we are putting ${it} back into your sellable stock`;
    case RtoDisposition.WRITE_OFF:
      return `we are writing ${it} off — not going back into your sellable stock`;
    case RtoDisposition.INSPECT_LATER:
      return `we are holding ${it} aside for a closer look, out of your sellable stock until we decide`;
    case RtoDisposition.HOLD_DAMAGED:
      return (
        `we are keeping ${it} aside for you in our damaged-goods area, out of your sellable stock, ` +
        `until you tell us here whether to send ${it} back to you or dispose of ${it}`
      );
  }
}

/**
 * The line's rows merged where they say the same thing (same condition,
 * disposition and note), in the order first seen. One group ⇒ the line
 * was not really split and the single form is used.
 */
function groupRows(rows: readonly ScrapTicketRowFact[]): ScrapTicketRowFact[] {
  const groups: ScrapTicketRowFact[] = [];
  for (const r of rows) {
    const notes = r.notes?.trim() ?? '';
    const same = groups.findIndex(
      (g) =>
        g.condition === r.condition && g.disposition === r.disposition && (g.notes ?? '') === notes,
    );
    const existing = same === -1 ? undefined : groups[same];
    if (existing !== undefined) {
      groups[same] = { ...existing, quantity: existing.quantity + r.quantity };
    } else {
      groups.push({ ...r, notes: notes === '' ? null : notes });
    }
  }
  return groups;
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
  const groups = f.rows === undefined ? [] : groupRows(f.rows);
  const only = groups.length === 1 ? groups[0] : undefined;
  // Every unit the same: the single form, with the group's own values.
  if (only !== undefined) {
    return singleFactLines(
      {
        ...f,
        condition: only.condition,
        disposition: only.disposition,
        notes: only.notes,
      },
      again,
    );
  }
  if (groups.length === 0) return singleFactLines(f, again);

  const lines: string[] = [
    `${f.productName} (${f.skuCode}), quantity ${f.quantity} — we checked each unit:`,
  ];
  for (const g of groups) {
    const note = g.notes === null ? '' : ` Inspector's note: "${g.notes}"`;
    lines.push(
      `• ${g.quantity} of ${f.quantity} ${foundPhraseCounted(g.condition, g.quantity)}: ` +
        `${dispositionPhraseCounted(g.disposition, g.quantity)}.${note}`,
    );
  }
  lines.push(...referenceLines(f));
  return lines;
}

function singleFactLines(f: ScrapTicketFacts, again: boolean): string[] {
  const lines: string[] = [
    `${f.productName} (${f.skuCode}), quantity ${f.quantity}: ${foundPhrase(f.condition, again)}.`,
    ...referenceLines(f),
  ];
  if (f.disposition !== null) {
    lines.push(`What we are doing with it: ${dispositionPhrase(f.disposition)}.`);
  }
  const notes = f.notes?.trim() ?? '';
  if (notes !== '') lines.push(`Inspector's note: "${notes}"`);
  return lines;
}

/** Order / parcel / waybill, then when and where it came back. */
function referenceLines(f: ScrapTicketFacts): string[] {
  const lines: string[] = [];
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
