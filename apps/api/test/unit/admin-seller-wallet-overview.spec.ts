import { Prisma, WalletEntryDirection } from '@skydrop/db';
import { AdminSellerWalletService } from '../../src/modules/admin-seller-wallet/services/admin-seller-wallet.service';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

/**
 * The wallet overview's last-movement column.
 *
 * It is read with a raw DISTINCT ON — one query instead of one per
 * seller — and raw SQL returns the COLUMN value (`order_charges`) while
 * every consumer switches on the Prisma name (`ORDER_CHARGES`). Those
 * switches are exhaustive and throw on anything else, so the mismatch
 * did not degrade a cell: it took the whole page down with "Unhandled
 * WalletEntryDirection: order_charges".
 */
function makeSut(lastMovements: Array<{ seller_id: string; direction: string; created_at: Date }>) {
  const client = {
    seller: {
      findMany: async () => [
        {
          id: 's-1',
          companyName: 'QA Test Traders',
          email: 'qa@example.com',
          status: 'APPROVED',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          walletBalances: [{ balance: D('1541.40'), updatedAt: new Date('2026-09-01T00:00:00Z') }],
        },
      ],
    },
    sellerWalletBalance: { findMany: async () => [] },
    sellerWalletEntry: { findFirst: async () => null },
    withdrawalRequest: { groupBy: async () => [] },
    walletTopupRequest: { groupBy: async () => [] },
    $queryRaw: async () => lastMovements,
  };
  return new AdminSellerWalletService(
    { client } as unknown as PrismaService,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('AdminSellerWalletService.overview — last movement', () => {
  it('returns the ENUM name, not the database column value', async () => {
    const svc = makeSut([
      {
        seller_id: 's-1',
        direction: 'order_charges',
        created_at: new Date('2026-09-06T00:00:00Z'),
      },
    ]);
    const { rows } = await svc.overview();
    expect(rows[0]?.lastMovementDirection).toBe(WalletEntryDirection.ORDER_CHARGES);
  });

  it('the value it returns is one the UI switch actually handles', async () => {
    /*
      The real assertion. A value the label helper cannot answer for
      does not render as a blank cell — it throws, during render, and
      takes the page with it.

      Read as SOURCE rather than imported: `@skydrop/ui` is ESM-only and
      jest cannot load it, which is the same reason the wallet-direction
      parity check in `order-charges-refund.service.spec.ts` reads the
      file. Asserting on `case WalletEntryDirection.X:` is enough — that
      is exactly the form the exhaustive switch takes.
    */
    const svc = makeSut([
      {
        seller_id: 's-1',
        direction: 'gst_withholding',
        created_at: new Date('2026-09-06T00:00:00Z'),
      },
    ]);
    const { rows } = await svc.overview();
    const d = rows[0]?.lastMovementDirection;
    expect(d).toBe(WalletEntryDirection.GST_WITHHOLDING);

    const ui = fs.readFileSync(
      path.resolve(__dirname, '../../../../packages/ui/src/status/index.ts'),
      'utf8',
    );
    expect(ui).toContain(`case WalletEntryDirection.${String(d)}:`);
  });

  it('an UNRECOGNISED direction comes back null rather than as itself', async () => {
    // A future direction that breaks the @map convention should reach
    // the page as an unlabelled row, never as a value that crashes it.
    const svc = makeSut([
      { seller_id: 's-1', direction: 'some_new_thing', created_at: new Date() },
    ]);
    const { rows } = await svc.overview();
    expect(rows[0]?.lastMovementDirection).toBeNull();
  });

  it('a wallet nothing has touched has no movement at all', async () => {
    const svc = makeSut([]);
    const { rows } = await svc.overview();
    expect(rows[0]?.lastMovementDirection).toBeNull();
    expect(rows[0]?.lastMovementAt).toBeNull();
  });
});
