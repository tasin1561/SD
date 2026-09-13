/**
 * What we tell a seller when a goods receipt comes up short (TKT-3).
 *
 * A RECEIPT_SHORTFALL ticket is opened by US, off the count, and names
 * WHICH LEG of the journey the units went missing on, because that
 * decides who is asked and who carries the loss:
 *
 *   SELLER_TO_FIRST_WAREHOUSE — the first time anybody counted (the
 *     Dhaka intake on a VIA_BD consignment, the Indian warehouse on a
 *     DIRECT_IN one, or India after a Dhaka stop that forwarded without
 *     counting). The seller declared more than we counted, so we ask
 *     them to confirm or dispute.
 *   IN_TRANSIT — the India leg of a VIA_BD consignment counted fewer than
 *     left Dhaka (IN_TRANSIT_LOSS). The units were in OUR hands; we look
 *     into it and may settle on the ticket.
 *
 * Damaged units are a third thing on either leg: taken up with the
 * forwarder that carried them.
 *
 * PURE: no Prisma, no clock. The caller gathers the facts; the words live
 * here once. Only facts — no refund figure, none is known yet.
 */

export type ShortfallLeg = 'SELLER_TO_FIRST_WAREHOUSE' | 'IN_TRANSIT';

export interface ReceiptLineFacts {
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly skuCode: string;
  /** Declared by the seller, or — on the India leg — sent from Dhaka. */
  readonly expectedQty: number;
  /** GOOD units counted (`goods_receipt_lines.received_qty`). */
  readonly receivedQty: number;
  /** Arrived damaged, not stocked (`damaged_qty`). */
  readonly damagedQty: number;
}

export interface WarehouseFacts {
  readonly code: string;
  readonly name: string;
  readonly timezone: string | null;
}

export interface ReceiptShortfallFacts {
  readonly consignmentNumber: string | null;
  readonly receiptNumber: string;
  readonly warehouse: WarehouseFacts;
  /** Where it left from, on the India leg — the Dhaka intake. */
  readonly originWarehouse: WarehouseFacts | null;
  /** When the count was completed (`goods_receipts.received_at`). */
  readonly receivedAt: Date | null;
  readonly leg: ShortfallLeg;
  readonly lines: readonly ReceiptLineFacts[];
}

/**
 * Units that did not turn up at all. `received_qty` counts GOOD units
 * and damaged ones are recorded beside it, so a damaged unit is not also
 * a missing one.
 */
export function shortOf(l: ReceiptLineFacts): number {
  return Math.max(0, l.expectedQty - l.receivedQty - l.damagedQty);
}

export function surplusOf(l: ReceiptLineFacts): number {
  return Math.max(0, l.receivedQty + l.damagedQty - l.expectedQty);
}

/** The lines a ticket is about: anything missing or damaged. */
export function affectedLines(lines: readonly ReceiptLineFacts[]): ReceiptLineFacts[] {
  return lines.filter((l) => shortOf(l) > 0 || l.damagedQty > 0);
}

/** The lines a surplus notification is about. Never a ticket. */
export function surplusLines(lines: readonly ReceiptLineFacts[]): ReceiptLineFacts[] {
  return lines.filter((l) => surplusOf(l) > 0);
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
 * `19 Aug 2026`, in the warehouse's own zone. From numeric parts, not a
 * locale's short month (current ICU spells September "Sept" in en-GB).
 */
export function formatCountDate(at: Date, timeZone: string | null): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone ?? DEFAULT_TIMEZONE,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(at);
  } catch {
    // A bad zone name on a warehouse row must not cost the seller the message.
    return formatCountDate(at, DEFAULT_TIMEZONE);
  }
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return `${read('day')} ${MONTHS[read('month') - 1] ?? ''} ${read('year')}`;
}

function where(w: WarehouseFacts): string {
  return `${w.code} (${w.name})`;
}

function product(l: ReceiptLineFacts): string {
  const variant = l.variantLabel?.trim() ?? '';
  return `${l.productName}${variant === '' ? '' : ` — ${variant}`} (${l.skuCode})`;
}

function units(n: number): string {
  return n === 1 ? '1 unit' : `${n} units`;
}

/** The ticket's subject — what a list shows. */
export function receiptShortfallSubject(f: ReceiptShortfallFacts): string {
  const lines = affectedLines(f.lines);
  const short = lines.reduce((n, l) => n + shortOf(l), 0);
  const damaged = lines.reduce((n, l) => n + l.damagedQty, 0);
  const what = [short > 0 ? `${short} short` : null, damaged > 0 ? `${damaged} damaged` : null]
    .filter((s): s is string => s !== null)
    .join(', ');
  return `${f.consignmentNumber ?? f.receiptNumber}: ${what} at ${f.warehouse.code}`;
}

/**
 * The opening message — stored as the ticket's `description`, which both
 * conversations render first, on OUR side.
 */
export function receiptShortfallOpeningMessage(
  f: ReceiptShortfallFacts & { readonly ticketNumber: string | null },
): string {
  const lines = affectedLines(f.lines);
  const expectedWord = f.leg === 'IN_TRANSIT' ? 'sent' : 'declared';
  const short = lines.reduce((n, l) => n + shortOf(l), 0);
  const damaged = lines.reduce((n, l) => n + l.damagedQty, 0);

  const header =
    f.ticketNumber === null
      ? `We opened this ticket for you because goods receipt ${f.receiptNumber} came up short.`
      : `Ticket ${f.ticketNumber} — we opened this for you because goods receipt ${f.receiptNumber} came up short.`;

  const refs = [
    f.consignmentNumber === null ? null : `Consignment ${f.consignmentNumber}`,
    `receipt ${f.receiptNumber}`,
  ]
    .filter((r): r is string => r !== null)
    .join(' · ');
  const counted =
    f.receivedAt === null
      ? `Counted at ${where(f.warehouse)}.`
      : `Counted at ${where(f.warehouse)} on ${formatCountDate(f.receivedAt, f.warehouse.timezone)}.`;

  const table = lines.map(
    (l) =>
      `${product(l)}: ${expectedWord} ${l.expectedQty} · counted ${l.receivedQty} · damaged ${l.damagedQty} · short ${shortOf(l)}`,
  );

  const why: string[] = [];
  if (short > 0 && f.leg === 'SELLER_TO_FIRST_WAREHOUSE') {
    why.push(
      `Where the ${units(short)} went missing: between you and our first warehouse. ` +
        `You declared more than we counted when the goods reached ${where(f.warehouse)}. ` +
        'Please check your packing list and reply below — confirm our count, or dispute it and ' +
        'tell us why (a photo of the packed cartons helps).',
    );
  }
  if (short > 0 && f.leg === 'IN_TRANSIT') {
    const from = f.originWarehouse === null ? 'our Bangladesh warehouse' : where(f.originWarehouse);
    why.push(
      `Where the ${units(short)} went missing: between ${from} and ${where(f.warehouse)}. ` +
        'They were counted out of Bangladesh and did not arrive in India, so they were in our ' +
        'hands. We are looking into it with the forwarder and will reply here. If they are not ' +
        'found, we settle it with you on this ticket; any refund is credited to your wallet and ' +
        'shown here.',
    );
  }
  if (damaged > 0) {
    why.push(
      `Arrived damaged: ${units(damaged)}. We are taking this up with the forwarder that ` +
        'carried them and will reply here. Damaged units are not in your sellable stock.',
    );
  }

  const nothingHeld =
    'Nothing is on hold because of this: the units we counted carry on as normal, and no money ' +
    'moves unless this ticket is settled with a refund.';

  return [header, [refs, counted].join('\n'), table.join('\n'), ...why, nothingHeld].join('\n\n');
}

export interface SurplusNotice {
  readonly title: string;
  readonly body: string;
}

/**
 * More arrived than was declared (or sent). A NOTIFICATION, never a
 * ticket: nobody lost anything, and nothing needs deciding.
 */
export function receiptSurplusNotice(f: ReceiptShortfallFacts): SurplusNotice | null {
  const lines = surplusLines(f.lines);
  if (lines.length === 0) return null;
  const than = f.leg === 'IN_TRANSIT' ? 'than were sent' : 'than declared';
  const first = lines[0];
  const title =
    lines.length === 1 && first !== undefined
      ? `${surplusOf(first)} more ${first.skuCode} ${than} arrived at ${f.warehouse.name}`
      : `More arrived ${than} on ${f.receiptNumber} at ${f.warehouse.name}`;
  const expectedWord = f.leg === 'IN_TRANSIT' ? 'sent' : 'declared';
  const ref =
    f.consignmentNumber === null
      ? `Goods receipt ${f.receiptNumber}`
      : `Consignment ${f.consignmentNumber}, goods receipt ${f.receiptNumber}`;
  const body = [
    `${ref}, counted at ${where(f.warehouse)}:`,
    ...lines.map(
      (l) =>
        `${product(l)}: ${expectedWord} ${l.expectedQty}, counted ${l.receivedQty + l.damagedQty} — ${surplusOf(l)} more.`,
    ),
    'The extra units carry on with the rest of your goods. Nothing for you to do.',
  ].join('\n');
  return { title, body };
}
