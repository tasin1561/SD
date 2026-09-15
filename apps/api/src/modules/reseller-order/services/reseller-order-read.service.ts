import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  readResellerOrderSnapshot,
  type ResellerOrderLineSnapshot,
  type ResellerOrderSnapshot,
} from '../../reseller-order-money/reseller-order-snapshot.read';

export type { ResellerOrderLineSnapshot, ResellerOrderSnapshot };

/**
 * RS-5 — THE seam the reseller money (phase 3c) reads: a reseller order's
 * snapshot, or null for a channel order.
 *
 * The read itself is the plain function `readResellerOrderSnapshot`
 * (reseller-order-money), which the money module calls directly: that
 * module sits under seller-wallet-accrual, which the order module imports,
 * so it cannot import this one (the R3 rule). One function, two callers —
 * never two copies of the select.
 *
 * Exported by `ResellerOrderModule`; it reads, never writes.
 */
@Injectable()
export class ResellerOrderReadService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshotFor(orderId: string): Promise<ResellerOrderSnapshot | null> {
    return readResellerOrderSnapshot(this.prisma.client, orderId);
  }
}
