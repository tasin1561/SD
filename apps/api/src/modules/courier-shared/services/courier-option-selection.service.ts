import { Injectable } from '@nestjs/common';

/**
 * One courier the carrier offered for one parcel.
 *
 * Exactly what Shiprocket's serviceability call returns, named in our
 * words. `estimatedDays` is theirs too — we do not derive it from the
 * ETD string, because their ETD is a display date in their timezone and
 * parsing it to get a number back would be inventing precision.
 */
export interface CourierOption {
  readonly courierCompanyId: number;
  readonly courierName: string;
  readonly rateInr: number;
  /** Null when the carrier did not say. Treated as "unknown", never as 0. */
  readonly estimatedDays: number | null;
  readonly etd: string | null;
}

/** Who picks, and on what basis. */
export type CourierSelectionPolicy =
  | 'SHIPROCKET_DEFAULT'
  | 'CHEAPEST'
  | 'FASTEST'
  | 'CHEAPEST_WITHIN_DAYS'
  | 'MANUAL';

export type SelectionOutcome =
  /** Book with this one. */
  | { readonly kind: 'CHOSEN'; readonly option: CourierOption; readonly why: string }
  /** Send it with no courier_id and let the carrier rank. */
  | { readonly kind: 'DEFER_TO_CARRIER'; readonly why: string }
  /** Pause the order and let a person decide. */
  | { readonly kind: 'ASK_A_HUMAN'; readonly why: string };

/**
 * The ONE place a policy becomes a courier.
 *
 * Pure — no Prisma, no HTTP, no settings read. It is handed the options
 * and the policy and returns a decision, which makes every rule here
 * testable against a table of rates instead of against a courier.
 *
 * ── WHY A SERVICE AND NOT A BRANCH AT THE CALL SITE ──────────────────
 * CUR-12: a courier is reached through a dispatcher, never a branch
 * where it is needed. The same reasoning applies to the CHOICE — the
 * AWB saga, the admin decision screen and the TTL sweep all need "what
 * would the policy pick", and three copies of that arithmetic is how
 * the sweep comes to disagree with the screen an operator was looking
 * at.
 *
 * ── F2 EXHAUSTIVE ────────────────────────────────────────────────────
 * The switch covers every policy and a new one fails to compile until
 * somebody decides what it means. The alternative — a default branch —
 * silently gives a new policy the behaviour of an old one.
 */
@Injectable()
export class CourierOptionSelectionService {
  select(
    options: readonly CourierOption[],
    policy: CourierSelectionPolicy,
    maxDays: number,
  ): SelectionOutcome {
    /*
      NOTHING TO CHOOSE FROM is not a policy question.

      An empty list means the carrier offered nothing — serviceability
      failed, or nowhere serves that pin. Handing that to a human wastes
      their time on a screen with no buttons, and asking the carrier to
      rank an empty list is the same request we just made. Let the
      booking proceed and fail with the carrier's own reason, which is
      the one an operator can act on.
    */
    if (options.length === 0) {
      return { kind: 'DEFER_TO_CARRIER', why: 'the carrier offered no options' };
    }

    /*
      ONE OPTION IS NOT A DECISION, whatever the policy says.

      A MANUAL pause here would hold a parcel — and its stock, and its
      customer — waiting for somebody to click the only button on the
      page. Measured and real: from our actual pickup pin the carrier
      returned exactly one courier.
    */
    if (options.length === 1) {
      const only = options[0] as CourierOption;
      return { kind: 'CHOSEN', option: only, why: 'the carrier offered only this one' };
    }

    switch (policy) {
      case 'SHIPROCKET_DEFAULT':
        return { kind: 'DEFER_TO_CARRIER', why: 'policy leaves the choice to the carrier' };

      case 'MANUAL':
        return {
          kind: 'ASK_A_HUMAN',
          why: `${options.length} options and policy says a person picks`,
        };

      case 'CHEAPEST': {
        const best = this.cheapest(options);
        return {
          kind: 'CHOSEN',
          option: best,
          why: `cheapest of ${options.length} at ₹${best.rateInr}`,
        };
      }

      case 'FASTEST': {
        const best = this.fastest(options);
        return {
          kind: 'CHOSEN',
          option: best,
          why:
            best.estimatedDays === null
              ? `fastest of ${options.length} (no day estimate given; cheapest used as the tie-break)`
              : `fastest of ${options.length} at ${best.estimatedDays} days`,
        };
      }

      case 'CHEAPEST_WITHIN_DAYS': {
        /*
          A DEADLINE FIRST, THEN A PRICE.

          Options with no day estimate are EXCLUDED from the qualifying
          set rather than assumed to qualify: "we do not know when it
          arrives" is not evidence that it arrives in time, and treating
          it as such would make the deadline meaningless exactly when it
          matters.

          If nothing qualifies we take the FASTEST, not the cheapest.
          The policy is a deadline with a price preference inside it;
          missing the deadline to save money inverts what was asked for.
        */
        const inTime = options.filter(
          (o) => o.estimatedDays !== null && o.estimatedDays <= maxDays,
        );
        if (inTime.length === 0) {
          const best = this.fastest(options);
          return {
            kind: 'CHOSEN',
            option: best,
            why: `nothing arrives within ${maxDays} days, so the fastest was taken`,
          };
        }
        const best = this.cheapest(inTime);
        return {
          kind: 'CHOSEN',
          option: best,
          why: `cheapest of ${inTime.length} arriving within ${maxDays} days, at ₹${best.rateInr}`,
        };
      }

      default: {
        const exhaustive: never = policy;
        throw new Error(`Unhandled courier selection policy: ${String(exhaustive)}`);
      }
    }
  }

  /** Lowest rate. Ties break on the earlier estimate, so "cheapest"
   *  never silently means "slowest of the equally cheap". */
  private cheapest(options: readonly CourierOption[]): CourierOption {
    return [...options].sort(
      (a, b) => a.rateInr - b.rateInr || this.days(a) - this.days(b),
    )[0] as CourierOption;
  }

  /** Earliest estimate. Ties break on price for the same reason. */
  private fastest(options: readonly CourierOption[]): CourierOption {
    return [...options].sort(
      (a, b) => this.days(a) - this.days(b) || a.rateInr - b.rateInr,
    )[0] as CourierOption;
  }

  /** An unknown estimate sorts LAST, never as 0 — a missing number must
   *  not win a race it never entered. */
  private days(o: CourierOption): number {
    return o.estimatedDays ?? Number.MAX_SAFE_INTEGER;
  }
}
