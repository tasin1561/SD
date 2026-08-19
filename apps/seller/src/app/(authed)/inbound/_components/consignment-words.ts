import {
  ConsignmentEventType,
  ConsignmentLeg,
  ConsignmentRoute,
  ConsignmentStatus,
} from '@skydrop/db';
import type { ConsignmentLegView, ConsignmentView } from '@skydrop/api-client';

/**
 * The consignment vocabulary, in the seller's words rather than the
 * database's.
 *
 * A seller has never heard of `VIA_BD` or `AT_BD`, and lower-casing an
 * enum does not turn it into English — "at bd" reads like a typo. Every
 * label a seller sees comes from HERE, so the list and the detail page
 * cannot describe the same consignment two different ways.
 *
 * Colours do NOT live here: those come from `consignmentStatusKind` in
 * `@skydrop/ui/status` (FE-6). This file is words only.
 */

/**
 * How the goods travel, and what it costs, said once.
 *
 * `hint` is what fits on the choice itself — enough to pick correctly
 * without reading a paragraph. `blurb` is the full answer, shown behind
 * the info toggle for somebody who wants it. Two sizes rather than one,
 * because a form that explains everything up front is a form nobody
 * reads.
 */
export function routeWords(route: ConsignmentRoute): {
  title: string;
  hint: string;
  blurb: string;
} {
  switch (route) {
    case ConsignmentRoute.DIRECT_IN:
      return {
        title: 'Straight to India',
        hint: 'You ship it there yourself',
        blurb:
          'You ship to our Indian warehouse yourself. One arrival, one count, and no inbound freight from us.',
      };
    case ConsignmentRoute.VIA_BD:
      return {
        title: 'Via our Bangladesh warehouse',
        hint: 'We move it on, and bill the freight',
        blurb:
          'You ship to Dhaka and we move it to India for you. This is the option we charge inbound freight for — the bill is raised once the forwarder invoices us.',
      };
    default: {
      const exhaustive: never = route;
      throw new Error(`Unhandled ConsignmentRoute: ${String(exhaustive)}`);
    }
  }
}

/**
 * Where the stock IS, as a sentence fragment.
 *
 * `AT_BD` deliberately says the country out loud: counted in Dhaka is
 * not the same as sellable, and a seller reading "received" would
 * reasonably start taking orders against it.
 */
export function statusWords(status: ConsignmentStatus): string {
  switch (status) {
    case ConsignmentStatus.PENDING:
      return 'Announced';
    case ConsignmentStatus.AT_BD:
      return 'At our Dhaka warehouse';
    case ConsignmentStatus.IN_TRANSIT:
      return 'On the way to India';
    case ConsignmentStatus.COMPLETED:
      return 'Arrived in India';
    case ConsignmentStatus.CANCELLED:
      return 'Cancelled';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled ConsignmentStatus: ${String(exhaustive)}`);
    }
  }
}

/**
 * What a leg MEANS, not which enum value it carries.
 *
 * A VIA_BD consignment can fly to India in more than one shipment, so
 * the India legs are numbered when there is more than one — otherwise
 * two identical headings sit above two different counts.
 */
export function legTitle(
  leg: ConsignmentLegView,
  route: ConsignmentRoute,
  indiaLegs: readonly ConsignmentLegView[],
): string {
  if (leg.leg === ConsignmentLeg.BD_INTAKE) return 'Counted at our Bangladesh warehouse';
  if (route === ConsignmentRoute.DIRECT_IN || indiaLegs.length <= 1) return 'Arrival in India';
  const n = indiaLegs.findIndex((r) => r.id === leg.id) + 1;
  return `Shipment ${n} of ${indiaLegs.length} to India`;
}

/** The India-bound legs, in the order they were created. */
export function indiaLegs(c: ConsignmentView): readonly ConsignmentLegView[] {
  return c.receipts.filter((r) => r.leg !== ConsignmentLeg.BD_INTAKE);
}

/**
 * How many distinct products are in it.
 *
 * Counted across every leg rather than off the first one: a VIA_BD
 * consignment's India legs each carry a subset, and summing line rows
 * would count a product once per shipment it travelled on.
 */
export function productCount(c: ConsignmentView): number {
  const ids = new Set<string>();
  for (const r of c.receipts) for (const l of r.lines) ids.add(l.variantId);
  return ids.size;
}

/** Units declared on this leg. */
export function declaredUnits(leg: ConsignmentLegView): number {
  return leg.lines.reduce((n, l) => n + l.expectedQty, 0);
}

/**
 * Units counted on this leg, or null while nobody has counted yet.
 *
 * The STATUS is what decides, not the quantities. `receivedQty` defaults
 * to 0 on a line nobody has touched, so summing it returned 0 for a
 * freshly announced consignment — indistinguishable from a warehouse
 * that opened the carton and genuinely found nothing. A seller who had
 * announced 300 units a minute earlier was told 300 were missing.
 */
export function countedUnits(leg: ConsignmentLegView): number | null {
  // Sent on unopened: there is no count, and a zero here would read as
  // a warehouse that looked and found nothing.
  if (leg.forwardedWithoutCount) return null;
  if (leg.status !== 'COMPLETED') return null;
  return leg.lines.reduce((n, l) => n + (l.receivedQty ?? 0), 0);
}

/**
 * A warehouse is counting this leg RIGHT NOW.
 *
 * There are three states, not two, and collapsing the middle one is
 * wrong in both directions. Reading `receivedQty` alone reported a
 * shortfall on a consignment nobody had opened; ignoring it entirely
 * told a seller "not counted yet" while somebody stood at the bench with
 * the numbers already typed in.
 *
 * Recorded quantities are PROVISIONAL until the receipt is completed —
 * that is the step that writes stock — so this deliberately drives a
 * "counting now" message and never a difference. A variance shown
 * against a half-finished count is a shortfall that mostly is not real.
 */
export function countingInProgress(leg: ConsignmentLegView): boolean {
  if (leg.status !== 'ARRIVING') return false;
  return leg.lines.some((l) => (l.receivedQty ?? 0) > 0);
}

/**
 * What is happening at this stop, in the seller's terms.
 *
 * A seller who has sent goods to another country wants to know four
 * things and they are genuinely different: has it got there, is anyone
 * looking at it, did anyone look at all, and what did they find. The
 * status alone answers none of them — `ARRIVING` means "we have it", and
 * nobody outside a warehouse reads it that way.
 */
export function legProgress(leg: ConsignmentLegView): { headline: string; detail: string } {
  if (leg.forwardedWithoutCount) {
    return {
      headline: 'Received and sent straight on',
      detail:
        'We had it and forwarded it without opening it, so it travels on the quantities you ' +
        'declared. It gets counted once, when it lands.',
    };
  }
  if (leg.status === 'COMPLETED') {
    return { headline: 'Counted', detail: 'This is what we found when we opened it.' };
  }
  if (leg.status === 'CANCELLED') {
    return { headline: 'Cancelled', detail: 'This stop was called off.' };
  }
  if (leg.status === 'ARRIVING') {
    return countingInProgress(leg)
      ? {
          headline: 'Being counted now',
          detail:
            'We have it and we are going through it. The numbers below are what we have reached ' +
            'so far, not the final answer.',
        }
      : {
          headline: 'Received — not opened yet',
          detail: 'It has arrived and we have it. Counting has not started.',
        };
  }
  return { headline: 'Not arrived yet', detail: 'We are expecting it.' };
}

/**
 * Whether cancelling is worth OFFERING. COSMETIC ONLY (FE-2) — the
 * server owns the window and refuses with
 * `CONSIGNMENT_ALREADY_DISPATCHED` / `CONSIGNMENT_ALREADY_ARRIVED`,
 * which is surfaced verbatim. This only decides whether a button that
 * would certainly be refused is shown at all.
 *
 * A single non-null `dispatchedAt` closes it: once anything has left
 * Bangladesh there is freight spent and a parcel in the air, and the
 * design refuses rather than inventing an answer for either.
 */
export function cancellable(c: ConsignmentView): boolean {
  if (c.status === ConsignmentStatus.CANCELLED || c.status === ConsignmentStatus.COMPLETED) {
    return false;
  }
  return !c.receipts.some((r) => r.dispatchedAt !== null);
}

/** A product name a seller recognises, variant included when there is one. */
export function lineLabel(line: {
  variant: { variantLabel: string | null; product: { name: string } };
}): string {
  const v = line.variant.variantLabel;
  return v === null || v === '' ? line.variant.product.name : `${line.variant.product.name} — ${v}`;
}

/** A date, or an em dash. Dates are read, not sorted, on these screens. */
export function shortDate(iso: string | null): string {
  return iso === null ? '—' : new Date(iso).toLocaleDateString('en-IN');
}

/**
 * A timeline stamp. Date AND time, because two events on the same day
 * with no time between them read as one event.
 */
export function stamp(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A timeline entry's headline. The server also sends a description; this
 * is the two or three words above it, so the column scans without
 * reading every sentence.
 */
export function eventWords(type: ConsignmentEventType): string {
  switch (type) {
    case ConsignmentEventType.DECLARED:
      return 'Announced';
    case ConsignmentEventType.BD_RECEIVED:
      return 'Counted in Bangladesh';
    case ConsignmentEventType.LABELS_PRINTED:
      return 'Labels printed';
    case ConsignmentEventType.DISPATCHED_TO_IN:
      return 'Left for India';
    case ConsignmentEventType.IN_RECEIVED:
      return 'Arrived in India';
    case ConsignmentEventType.VARIANCE_RECORDED:
      return 'Count difference';
    case ConsignmentEventType.FREIGHT_RECORDED:
      return 'Freight billed';
    case ConsignmentEventType.CANCELLED:
      return 'Cancelled';
    default: {
      const exhaustive: never = type;
      throw new Error(`Unhandled ConsignmentEventType: ${String(exhaustive)}`);
    }
  }
}
