import { Injectable, NotFoundException } from '@nestjs/common';
import type { CredentialEnvironment } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface SelectedCourierAccount {
  readonly courierAccountId: string;
  /** Which rule picked this account — useful for audit/debug, not a decision input. */
  readonly source: 'SELLER_LINK' | 'DEFAULT_ACCOUNT';
}

/**
 * R1 (revised-plan roadmap) — pure account-selection logic for
 * multi-account courier routing. A seller with ≥1 active
 * `SellerCourierAccountLink` for the given (courier, environment) gets
 * weighted-random-distributed across those linked accounts
 * (`distributionWeight`, e.g. 70/30). A seller with NO link falls back
 * to that (courier, environment)'s DEFAULT active `CourierAccount` —
 * this preserves today's single-account behavior unchanged for every
 * seller who hasn't been explicitly assigned to specific accounts.
 *
 * Dependency-free (PrismaService only) so both `courier-awb` (AWB
 * generation) and any future dispatch-time caller can import it
 * without a module cycle — same R3 shape as call-queue /
 * shipment-provision / lifecycle-events / settings.
 *
 * NOT YET WIRED into AWB generation in this commit — that touches the
 * CUR-2 production saga and is a deliberately separate follow-up so it
 * gets its own focused regression pass against the existing AWB test
 * suite. This service is complete and independently testable today;
 * `Shipment.courierAccountId` exists and is ready to be populated once
 * the wiring lands.
 */
@Injectable()
export class CourierAccountRoutingService {
  constructor(private readonly prisma: PrismaService) {}

  async selectAccount(
    sellerId: string,
    courierId: string,
    environment: CredentialEnvironment,
  ): Promise<SelectedCourierAccount> {
    const links = await this.prisma.client.sellerCourierAccountLink.findMany({
      where: {
        sellerId,
        isActive: true,
        courierAccount: { courierId, environment, isActive: true, deletedAt: null },
      },
      select: { courierAccountId: true, distributionWeight: true },
    });

    if (links.length > 0) {
      return { courierAccountId: this.weightedPick(links), source: 'SELLER_LINK' };
    }

    const defaultAccount = await this.prisma.client.courierAccount.findFirst({
      where: { courierId, environment, isDefault: true, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!defaultAccount) {
      throw new NotFoundException({
        code: 'NO_COURIER_ACCOUNT_AVAILABLE',
        message: `No courier account (linked or default) available for courier ${courierId} / ${environment}`,
      });
    }
    return { courierAccountId: defaultAccount.id, source: 'DEFAULT_ACCOUNT' };
  }

  // ── internals ──

  private weightedPick(
    links: readonly { courierAccountId: string; distributionWeight: number }[],
  ): string {
    const first = links[0];
    if (first === undefined) {
      // Callers only reach here after checking links.length > 0.
      throw new Error('weightedPick called with an empty links array');
    }
    const total = links.reduce((sum, l) => sum + Math.max(l.distributionWeight, 0), 0);
    if (total <= 0) return first.courierAccountId; // all-zero weights — degenerate, just pick the first
    let roll = Math.random() * total;
    let lastId = first.courierAccountId;
    for (const l of links) {
      lastId = l.courierAccountId;
      roll -= Math.max(l.distributionWeight, 0);
      if (roll <= 0) return l.courierAccountId;
    }
    return lastId; // floating-point rounding guard
  }
}
