import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/** One ledger line about an order, as the client's own wallet page shows it. */
export interface AssistantOrderWalletEntry {
  readonly at: string;
  readonly direction: string;
  readonly currency: string;
  readonly amount: string;
  readonly reasonCode: string | null;
  readonly note: string | null;
}

/**
 * What the assistant may read of the wallet ledger for ONE order.
 *
 * READ-ONLY and beside — not inside — `WalletService`, the sole writer of
 * `seller_wallet_entries` (W-2). It selects the same columns the client's
 * `GET /seller/wallet/entries` route returns for a row, minus the running
 * balance (an explanation of an order's charges does not need the
 * balance, and a model that never receives it cannot repeat it).
 *
 * The caller's `sellerId` is in the `where` together with the order id, so
 * an entry of another seller can never match even if the order id were
 * somebody else's.
 */
@Injectable()
export class SellerWalletAssistantReadService {
  constructor(private readonly prisma: PrismaService) {}

  async entriesForOrder(
    sellerId: string,
    orderId: string,
  ): Promise<readonly AssistantOrderWalletEntry[]> {
    const rows = await this.prisma.client.sellerWalletEntry.findMany({
      where: { sellerId, linkedOrderId: orderId },
      orderBy: { id: 'asc' },
      take: 50,
      select: {
        direction: true,
        currency: true,
        amount: true,
        reasonCode: true,
        note: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      at: r.createdAt.toISOString(),
      direction: String(r.direction),
      currency: String(r.currency),
      amount: r.amount.toFixed(2),
      reasonCode: r.reasonCode,
      note: r.note,
    }));
  }
}
