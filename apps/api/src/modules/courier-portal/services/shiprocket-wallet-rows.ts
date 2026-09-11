import { createHash } from 'node:crypto';
import type { LedgerTxn } from '../../wallet-ledger/services/wallet-ledger-parser';
import type { PortalRecharge } from '../pages/wallet-recharges.page';

/**
 * Shiprocket's wallet tabs, read as rows of text, turned into facts.
 *
 * Pure: no browser, no database. Everything that decides what a row
 * MEANS lives here, where it can be tested against real rows, and the
 * page object only fetches them.
 *
 * ── WHAT THE PASSBOOK HOLDS (measured 2026-09-11, 7,138 rows / 90 days)
 * Every wallet movement, newest first, each with the balance after it:
 *
 *   PARCEL — per waybill: freight forward / COD / RTO (applied,
 *     reversed, updated, excess weight) and the per-order extras they
 *     bill against it (WhatsApp messages, RTO-risk scoring, Delivery
 *     Boost). What moving that parcel cost.
 *   ADJUSTMENT — per account: lost-shipment credit notes, invoice credits
 *     applied and removed, subscription credits, the ShipSure insurance
 *     premium and refund, and a charge on an order that never got a
 *     waybill (nothing to attribute it to). The P&L's "Courier account
 *     adjustments" line, exactly as Delhivery's are.
 *   RECHARGE — our own money going in ("Bank ReferenceNo: pay_…"). NOT a
 *     transaction here: counted as a credit it would read as the courier
 *     refunding ₹10,000 of cost. It is matched against our bank book from
 *     the Recharge History instead, and still takes part in the balance
 *     chain below, because it moved the balance.
 *
 * ── THEY GIVE NO TRANSACTION ID ──────────────────────────────────────
 * So one is derived: a hash of the minute, order, waybill, type, sub
 * category, description and signed amount, plus an ordinal among rows
 * identical in all of those (three pairs in 90 days — two charges in the
 * same minute for the same thing). The running balance is deliberately
 * NOT in the key: it is evidence (kept in `detail`), but a key that
 * moved whenever they recomputed a balance would make every later row
 * look new and every held one look vanished. Ordinals count from the
 * OLDEST row, so a new identical row lands at the end and cannot shift
 * the ids already held; a read is always of whole days, so a group never
 * straddles its edge.
 *
 * ── THE PASSBOOK CHECKS ITSELF ───────────────────────────────────────
 * Each row's balance is the one before it plus its own amount. Walking
 * that chain across every row proves nothing was dropped or misread
 * between the first and the last — the same guarantee Delhivery's
 * opening + recharges + refunds − deductions = closing gives, row by row.
 */

export class ShiprocketWalletFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShiprocketWalletFormatError';
  }
}

const MONTHS: Readonly<Record<string, number>> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};
const IST_OFFSET_MS = 330 * 60 * 1000;

/** "11 Sep, 2026 07:10 PM" or "03 Sep, 2026" — their IST clock — as UTC. */
export function parseShiprocketDate(raw: string): Date | null {
  const m = /^(\d{2}) ([A-Z][a-z]{2}), (\d{4})(?: (\d{2}):(\d{2}) ([AP]M))?$/.exec(raw.trim());
  if (m === null) return null;
  const month = MONTHS[m[2] ?? ''];
  if (month === undefined) return null;
  let hour = m[4] === undefined ? 0 : Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  if (m[6] === 'PM' && hour !== 12) hour += 12;
  if (m[6] === 'AM' && hour === 12) hour = 0;
  const utc = Date.UTC(Number(m[3]), month, Number(m[1]), hour, minute) - IST_OFFSET_MS;
  return new Date(utc);
}

/**
 * "- ₹ 66.15", "+ ₹ 15,000.00", "₹ -19.98", "₹ 460" → signed paise.
 * Paise, not a float: a chain of seven thousand additions in floating
 * point drifts, and a drift is exactly what the chain check looks for.
 */
export function parseShiprocketMoney(raw: string): number | null {
  const m = /^([+-])?\s*₹\s*(-)?\s*([\d,]+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (m === null) return null;
  const rupees = Number((m[3] ?? '').replace(/,/g, ''));
  const paise = Number(((m[4] ?? '') + '00').slice(0, 2));
  if (!Number.isFinite(rupees)) return null;
  const magnitude = rupees * 100 + paise;
  const negative = (m[1] === '-') !== (m[2] === '-');
  return negative ? -magnitude : magnitude;
}

export const paiseToInr = (p: number): string => {
  const sign = p < 0 ? '-' : '';
  const a = Math.abs(p);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};

export const isRechargeDescription = (d: string): boolean =>
  /Bank ReferenceNo|Payment Gateway/i.test(d);

const bankRef = (d: string): string | null => /Bank ReferenceNo:\s*([^\s|]+)/i.exec(d)?.[1] ?? null;

/** A recharge as the PASSBOOK shows it — with the exact time the history lacks. */
export interface PassbookRecharge {
  readonly bankTxnRef: string | null;
  readonly amountInr: string;
  readonly occurredAt: Date;
}

/** A non-parcel credit, for checking the Ledger against. */
export interface PassbookCredit {
  readonly amountPaise: number;
  readonly occurredAt: Date;
  readonly description: string;
}

export interface ChainBreak {
  /** The newer of the two rows that disagree. */
  readonly at: string;
  readonly description: string;
  readonly expectedInr: string;
  readonly foundInr: string;
}

export interface PassbookRead {
  readonly txns: readonly LedgerTxn[];
  readonly recharges: readonly PassbookRecharge[];
  readonly accountCredits: readonly PassbookCredit[];
  readonly rowsRead: number;
  readonly periodFrom: Date | null;
  readonly periodTo: Date | null;
  /** Σ debits among the stored transactions. */
  readonly debitsInr: string;
  readonly chainBreaks: readonly ChainBreak[];
  /** The newest row's balance: what their wallet should read right now. */
  readonly newestBalanceInr: string | null;
}

type Category = 'PARCEL' | 'ADJUSTMENT' | 'RECHARGE';

/** Which of the three a passbook row is. See the file comment. */
export function classifyPassbookRow(row: readonly string[]): Category {
  const awb = (row[2] ?? '').trim();
  const type = (row[3] ?? '').trim();
  const sub = (row[4] ?? '').trim();
  const description = (row[5] ?? '').trim();
  if (type === 'Recharge and Credit') {
    return isRechargeDescription(description) ? 'RECHARGE' : 'ADJUSTMENT';
  }
  if (sub === 'Ship Sure') return 'ADJUSTMENT';
  if (awb === '' || awb === 'NA') return 'ADJUSTMENT';
  return 'PARCEL';
}

/**
 * The passbook's rows (newest first, as their page lists them) as
 * transactions. REFUSES a row it cannot read rather than skipping it —
 * a skipped row is money that silently did not happen.
 */
export function parsePassbook(rows: readonly (readonly string[])[]): PassbookRead {
  interface Parsed {
    readonly row: readonly string[];
    readonly at: Date;
    readonly amount: number;
    readonly balance: number;
  }
  const parsed: Parsed[] = rows.map((row, i) => {
    const at = parseShiprocketDate(row[0] ?? '');
    const amount = parseShiprocketMoney(row[6] ?? '');
    const balance = parseShiprocketMoney(row[7] ?? '');
    if (row.length !== 8 || at === null || amount === null || balance === null) {
      throw new ShiprocketWalletFormatError(
        `passbook row ${i + 1} could not be read: ${JSON.stringify(row).slice(0, 200)}`,
      );
    }
    return { row, at, amount, balance };
  });

  // The chain, newest first: a row's balance is the older one's plus its amount.
  const chainBreaks: ChainBreak[] = [];
  for (let i = 0; i + 1 < parsed.length; i++) {
    const newer = parsed[i];
    const older = parsed[i + 1];
    if (newer === undefined || older === undefined) continue;
    const expected = older.balance + newer.amount;
    if (expected !== newer.balance) {
      chainBreaks.push({
        at: newer.row[0] ?? '',
        description: (newer.row[5] ?? '').slice(0, 120),
        expectedInr: paiseToInr(expected),
        foundInr: paiseToInr(newer.balance),
      });
    }
  }

  const txns: LedgerTxn[] = [];
  const recharges: PassbookRecharge[] = [];
  const accountCredits: PassbookCredit[] = [];
  const ordinals = new Map<string, number>();
  let debits = 0;

  // Oldest first, so an ordinal never moves once assigned.
  for (let i = parsed.length - 1; i >= 0; i--) {
    const p = parsed[i];
    if (p === undefined) continue;
    const [, orderIdRaw = '', awbRaw = '', type = '', sub = '', description = ''] = p.row;
    const category = classifyPassbookRow(p.row);
    const credit = p.amount > 0;

    if (category === 'RECHARGE') {
      recharges.push({
        bankTxnRef: bankRef(description),
        amountInr: paiseToInr(Math.abs(p.amount)),
        occurredAt: p.at,
      });
      continue;
    }
    if (category === 'ADJUSTMENT' && credit) {
      accountCredits.push({ amountPaise: p.amount, occurredAt: p.at, description });
    }

    const base = [
      p.at.toISOString(),
      orderIdRaw,
      awbRaw,
      type,
      sub,
      description,
      String(p.amount),
    ].join('|');
    const n = (ordinals.get(base) ?? 0) + 1;
    ordinals.set(base, n);
    const hash = createHash('sha256').update(base).digest('hex').slice(0, 32);
    const awb = awbRaw === '' || awbRaw === 'NA' ? null : awbRaw;
    if (!credit) debits += -p.amount;

    txns.push({
      txnId: `SRPB-${hash}-${n}`,
      // An adjustment names no parcel even when its text mentions one:
      // a lost-shipment credit is account money, not a refund of carriage.
      awbNumber: category === 'PARCEL' ? awb : null,
      kind: credit ? 'CREDIT' : 'DEBIT',
      category,
      leg: sub === 'Freight RTO' ? 'RTO' : 'FORWARD',
      amountInr: paiseToInr(Math.abs(p.amount)),
      occurredAt: p.at,
      status: 'success',
      shipmentStatus: `${type} · ${sub}`,
      detail: {
        orderId: orderIdRaw === 'NA' ? null : orderIdRaw,
        awbNumber: awb,
        transactionType: type,
        subCategory: sub,
        description,
        balanceAfterInr: paiseToInr(p.balance),
      },
    });
  }

  const times = parsed.map((p) => p.at.getTime());
  return {
    txns,
    recharges,
    accountCredits,
    rowsRead: rows.length,
    periodFrom: times.length === 0 ? null : new Date(Math.min(...times)),
    periodTo: times.length === 0 ? null : new Date(Math.max(...times)),
    debitsInr: paiseToInr(debits),
    chainBreaks,
    newestBalanceInr: parsed[0] === undefined ? null : paiseToInr(parsed[0].balance),
  };
}

/**
 * Recharge History rows as recharges. The passbook's copy of the same
 * payment (matched on the bank's reference) supplies the exact time the
 * history leaves out; failing that, the day's start in IST.
 */
export function parseRechargeHistory(
  rows: readonly (readonly string[])[],
  fromPassbook: readonly PassbookRecharge[] = [],
): PortalRecharge[] {
  return rows.map((row, i) => {
    const [dateRaw = '', txnId = '', amountRaw = '', status = '', , description = ''] = row;
    const day = parseShiprocketDate(dateRaw);
    const amount = parseShiprocketMoney(amountRaw);
    if (row.length !== 6 || day === null || amount === null || txnId.trim() === '') {
      throw new ShiprocketWalletFormatError(
        `recharge row ${i + 1} could not be read: ${JSON.stringify(row).slice(0, 200)}`,
      );
    }
    const ref = bankRef(description);
    const exact = ref === null ? undefined : fromPassbook.find((r) => r.bankTxnRef === ref);
    return {
      externalTxnId: txnId.trim(),
      bankTxnRef: ref,
      amountInr: paiseToInr(Math.abs(amount)),
      status: status.trim(),
      occurredAt: exact?.occurredAt ?? day,
    };
  });
}

/** One Ledger row: an accounting document or a wallet movement. */
export interface LedgerEntry {
  readonly date: Date;
  readonly particulars: string;
  readonly debitPaise: number;
  readonly creditPaise: number;
  readonly description: string;
}

export function parseLedgerRows(rows: readonly (readonly string[])[]): LedgerEntry[] {
  return rows.map((row, i) => {
    const [dateRaw = '', , particulars = '', debitRaw = '', creditRaw = '', description = ''] = row;
    const date = parseShiprocketDate(dateRaw);
    const debit = parseShiprocketMoney(debitRaw);
    const credit = parseShiprocketMoney(creditRaw);
    if (row.length !== 7 || date === null || debit === null || credit === null) {
      throw new ShiprocketWalletFormatError(
        `ledger row ${i + 1} could not be read: ${JSON.stringify(row).slice(0, 200)}`,
      );
    }
    return {
      date,
      particulars: particulars.trim(),
      debitPaise: Math.abs(debit),
      creditPaise: Math.abs(credit),
      description: description.trim(),
    };
  });
}

/** Ledger lines that put money INTO the wallet — each must be in the passbook. */
const LEDGER_WALLET_CREDITS = new Set(['Credit Note', 'Other Wallet Credits', 'Recharge']);
/**
 * An Early COD credit is NOT a wallet movement: it cancels its own Early
 * COD invoice (₹90 against ₹90 on 1 Aug), and the fee itself comes out of
 * the COD remittance, never the wallet. Checking it against the passbook
 * would flag, every night, money nobody ever expected there.
 */
const NOT_A_WALLET_CREDIT = /^Early COD Credit/i;
/**
 * How far apart their Ledger and Passbook may date the same credit. A
 * lost-shipment credit note reached the wallet on 27 Jul and the Ledger on
 * 7 Aug — eleven days — so a few days' tolerance flagged real, present
 * credits as missing. Each is paired with the NEAREST unclaimed movement
 * of the same amount, so a wide window does not pair the wrong two.
 */
const LEDGER_MATCH_DAYS = 15;

export interface LedgerCoverage {
  /** Wallet credits in their Ledger. */
  readonly checked: number;
  /** Of those, the ones with no passbook movement to match. */
  readonly uncovered: ReadonlyArray<{
    readonly date: string;
    readonly particulars: string;
    readonly amountInr: string;
    readonly description: string;
  }>;
  /** Invoices: summaries of charges the passbook already carries. Counted, never booked. */
  readonly documents: number;
}

/**
 * Is every wallet credit in their Ledger also in their Passbook?
 *
 * The Ledger is their ACCOUNTING view: invoices that summarise the
 * passbook's charges, and credit notes, recharges and other credits that
 * the passbook also shows as movements. Booking both would count the
 * same rupee twice, so the passbook is the one booked and the Ledger is
 * the check on it: a credit it lists that no passbook row matches (same
 * amount, within a few days) is money their accounts say we received and
 * their wallet never showed — named, never guessed at.
 */
export function ledgerCoverage(
  entries: readonly LedgerEntry[],
  passbook: Pick<PassbookRead, 'recharges' | 'accountCredits'>,
): LedgerCoverage {
  const pool: Array<{ amountPaise: number; at: number; used: boolean }> = [
    ...passbook.accountCredits.map((c) => ({
      amountPaise: c.amountPaise,
      at: c.occurredAt.getTime(),
      used: false,
    })),
    ...passbook.recharges.map((r) => ({
      amountPaise: Math.round(Number(r.amountInr) * 100),
      at: r.occurredAt.getTime(),
      used: false,
    })),
  ];
  const window = LEDGER_MATCH_DAYS * 24 * 60 * 60 * 1000;
  let checked = 0;
  let documents = 0;
  const uncovered: Array<LedgerCoverage['uncovered'][number]> = [];

  // Oldest first, so an earlier ledger line claims the earlier movement.
  for (const e of [...entries].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    if (
      !LEDGER_WALLET_CREDITS.has(e.particulars) ||
      e.creditPaise === 0 ||
      NOT_A_WALLET_CREDIT.test(e.description)
    ) {
      if (e.debitPaise !== 0 || NOT_A_WALLET_CREDIT.test(e.description)) documents += 1;
      continue;
    }
    checked += 1;
    let hit: (typeof pool)[number] | undefined;
    for (const p of pool) {
      if (p.used || p.amountPaise !== e.creditPaise) continue;
      const gap = Math.abs(p.at - e.date.getTime());
      if (gap > window) continue;
      if (hit === undefined || gap < Math.abs(hit.at - e.date.getTime())) hit = p;
    }
    if (hit !== undefined) {
      hit.used = true;
      continue;
    }
    uncovered.push({
      date: e.date.toISOString().slice(0, 10),
      particulars: e.particulars,
      amountInr: paiseToInr(e.creditPaise),
      description: e.description.slice(0, 120),
    });
  }
  return { checked, uncovered, documents };
}
