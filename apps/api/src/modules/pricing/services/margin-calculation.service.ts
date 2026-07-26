import { Injectable } from '@nestjs/common';
import { Prisma } from '@skydrop/db';

export interface MarginResult {
  /** What the seller is actually charged for base shipping (post seller-discount). */
  readonly baseChargeInr: string;
  /** What Skydrop actually pays the courier for this line, if seeded. */
  readonly costToSkydropInr: string | null;
  /** baseChargeInr − costToSkydropInr. `null` when cost is unseeded (unknown, not zero). */
  readonly marginInr: string | null;
}

/**
 * R1c (revised-plan roadmap) — wires the previously-unused
 * `RateCardItem.costToSkydropInr` into a real margin figure. Pure
 * calculation, no Prisma access, no persistence — mirrors the
 * single-source pure-logic services already in this codebase
 * (CallOutcomeMappingService, TrackingStatusMappingService,
 * NotificationEventMappingService).
 *
 * Margin is realized purely as an internal/admin-visible figure — it
 * NEVER touches the seller's wallet. The seller is debited exactly the
 * (marked-up) `baseChargeInr`-derived total, same as before this
 * existed; margin is Skydrop's own accounting, reconciled against real
 * courier invoices outside the seller ledger entirely.
 *
 * A `null` margin (cost unseeded) is deliberately distinct from a zero
 * margin — Phase 1A has no real seed data for `costToSkydropInr` on
 * most rate-card items (per docs/phase-1a-debt.md), so "unknown" must
 * stay visibly unknown rather than silently reading as break-even.
 */
@Injectable()
export class MarginCalculationService {
  compute(
    baseChargeInr: Prisma.Decimal,
    costToSkydropInr: Prisma.Decimal | null,
  ): MarginResult {
    if (costToSkydropInr === null) {
      return {
        baseChargeInr: baseChargeInr.toFixed(2),
        costToSkydropInr: null,
        marginInr: null,
      };
    }
    return {
      baseChargeInr: baseChargeInr.toFixed(2),
      costToSkydropInr: costToSkydropInr.toFixed(2),
      marginInr: baseChargeInr.minus(costToSkydropInr).toFixed(2),
    };
  }
}
