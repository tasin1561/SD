import { Prisma } from '@skydrop/db';
import type { UpdateOrderDto } from './dto/update-order.dto';
import type { ResellerMoneyRecalculation } from '../reseller-order-money/services/reseller-order-money.service';

/**
 * WHAT CHANGED, in words, old → new (owner, 2026-09-18).
 *
 * Pure — no Prisma, no DI — because both notices read it and a second
 * copy phrased differently is how the store and seller staff come to be
 * told two different things about one edit.
 *
 * ── OLD → NEW, ALWAYS ────────────────────────────────────────────────
 * "The delivery details changed" is not something anybody can act on. A
 * store ringing a customer back, or seller staff deciding whether to
 * chase it, both need the value that was there before — most edits are a
 * correction of one character, and the only way to see that is to be
 * shown both.
 *
 * A field the edit did not send is not listed. A field sent with the
 * value it already had is not listed either: an edit form round-trips
 * every field it renders, so listing those would bury the one that moved
 * under nine that did not.
 */

/** What a person calls each field. Recipient labels match the queue's. */
const FIELD_LABEL: Readonly<Record<string, string>> = {
  recipientName: 'Name',
  recipientPhoneE164: 'Phone',
  recipientAltPhoneE164: 'Second phone',
  recipientEmail: 'Email',
  recipientAddressLine1: 'Address',
  recipientAddressLine2: 'Landmark line',
  recipientLandmark: 'Landmark',
  recipientCity: 'City',
  recipientStateProvince: 'State',
  recipientPostalCode: 'PIN code',
  paymentMode: 'How it is paid for',
  codAmountInr: 'Cash to collect',
  advanceAmountInr: 'Advance already paid',
  deliveryFeeInr: 'Delivery charged to the customer',
  discountInr: 'Discount',
  declaredValueInr: 'Declared value',
  totalWeightGrams: 'Weight (g)',
  packageType: 'Package',
  isUrgent: 'Urgent',
  sellerOrderRef: 'Reference',
  sellerNotes: 'Notes',
  internalNotes: 'Internal notes',
};

/** A value as somebody reads it, never `[object Object]` or `null`. */
function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(blank)';
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/**
 * Decimal-aware equality, so `200` and `200.00` are ONE value.
 *
 * This is not cosmetic. The stored side of a money field is a
 * `Prisma.Decimal` rendered as `998.00` and the patch side is a plain
 * `998` from JSON; compared as strings they differ, so a form that
 * round-tripped the amount unchanged would tell the other party "Cash to
 * collect: 998.00 → 998" on every save. Numbers are compared as numbers.
 */
function same(before: unknown, after: unknown): boolean {
  const a = show(before);
  const b = show(after);
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  return a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

interface OrderBefore {
  readonly items: readonly {
    readonly variantId: string;
    readonly skuCode: string;
    readonly quantity: number;
    readonly unitPriceInr: Prisma.Decimal | null;
  }[];
  readonly [key: string]: unknown;
}

/** "3 × SKU-1 at ₹500.00" — one line of an order, as a person reads it. */
function lineText(l: {
  skuCode: string;
  quantity: number;
  unitPriceInr: Prisma.Decimal | null;
}): string {
  const price = l.unitPriceInr === null ? '' : ` at ₹${l.unitPriceInr.toFixed(2)}`;
  return `${l.quantity} × ${l.skuCode}${price}`;
}

export function describeOrderChanges(
  before: OrderBefore,
  patch: UpdateOrderDto,
  changed: readonly string[],
): string {
  const out: string[] = [];
  for (const key of Object.keys(FIELD_LABEL)) {
    const next = (patch as Record<string, unknown>)[key];
    if (next === undefined) continue;
    const prev = before[key];
    if (same(prev, next)) continue;
    out.push(`${FIELD_LABEL[key] ?? key}: ${show(prev)} → ${show(next)}`);
  }
  if (changed.includes('items') && patch.items !== undefined) {
    const was = before.items.map((l) => lineText(l)).join('; ');
    // The patch carries variant ids, not SKU codes — the reader gets the
    // quantity and the price, which is what actually moved, and the order
    // page has the rest. Naming a variant id here would be noise.
    const now = patch.items
      .map((i) => {
        const known = before.items.find((l) => l.variantId === i.variantId);
        const price =
          i.unitPriceInr === undefined
            ? ''
            : ` at ₹${new Prisma.Decimal(i.unitPriceInr).toFixed(2)}`;
        return `${i.quantity} × ${known?.skuCode ?? 'a product newly added'}${price}`;
      })
      .join('; ');
    out.push(`What is in the parcel: ${was === '' ? '(nothing)' : was} → ${now}`);
  }
  return out.length === 0 ? 'Nothing on the order itself changed.' : out.join('\n');
}

/**
 * The money's before and after, per party — the owner's rule that the
 * store is told the old and new figures.
 *
 * Empty string when nothing moved, so a template can print it
 * unconditionally without a stray heading over nothing.
 */
export function describeMoneyMove(result: ResellerMoneyRecalculation | null): string {
  if (result === null || result.outcome !== 'REPLANNED') return '';
  const lines: string[] = [];
  for (const p of result.parties) {
    if (p.what === 'UNCHANGED') continue;
    // Named rather than "you": both sides read the same sentence, so a
    // second-person phrasing would be wrong for one of them.
    const who = p.party === 'STORE' ? 'The store is' : 'The seller is';
    // Always a PLAN that moved, never money already paid: the contents
    // freeze at confirmation and a reseller credit runs at or after
    // delivery, so nothing re-priced here has been written to a wallet
    // (`ResellerOrderMoneyService.recalculateAfterEdit` refuses if it has).
    lines.push(`${who} now credited ₹${p.after.netInr} on this order (was ₹${p.before.netInr}).`);
  }
  if (result.prepaid !== null) {
    lines.push(
      `What the store pays up front for this prepaid order: ₹${result.prepaid.beforeInr} → ₹${result.prepaid.afterInr}.`,
    );
  }
  return lines.join('\n');
}
