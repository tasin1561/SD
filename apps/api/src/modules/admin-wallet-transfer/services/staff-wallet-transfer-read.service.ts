import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BankEntryType,
  BankOwnerKind,
  Currency,
  Prisma,
  SellerStatus,
  WalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BankLedgerService } from '../../treasury/services/bank-ledger.service';
import {
  AUDIT_ACTION,
  TRANSFERABLE,
  type StaffTransferDirection,
} from './staff-wallet-transfer.service';

const ZERO = new Prisma.Decimal(0);

export interface StaffTransferRow {
  readonly id: string;
  readonly sellerId: string;
  readonly companyName: string;
  readonly direction: StaffTransferDirection;
  readonly amountInr: string;
  readonly walletAfterInr: string;
  readonly reason: string | null;
  readonly internalNote: string | null;
  readonly staff: string | null;
  readonly accounts: ReadonlyArray<{ readonly label: string; readonly amount: string }>;
  readonly createdAt: Date;
}

/**
 * What the wallet-transfer page SHOWS: past transfers, the seller picker,
 * and a seller's wallet and holdings before a preview.
 *
 * Kept apart from `StaffWalletTransferService` on purpose. That service
 * writes the wallet, and every ledger read in a writer must sit under the
 * WALLET lock (WAL-7; `wallet-guard-locking.spec.ts` reads the sources to
 * pin it). These reads decide nothing — the preview and the transfer
 * re-read everything under the locks — so they belong in a reader, where
 * an unlocked read is correct rather than an exception to explain.
 */
@Injectable()
export class StaffWalletTransferReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: BankLedgerService,
  ) {}

  /** Past staff transfers, newest first. */
  async list(query: { sellerId?: string; limit?: number }): Promise<{ items: StaffTransferRow[] }> {
    const take = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const entries = await this.prisma.client.sellerWalletEntry.findMany({
      where: {
        direction: { in: [WalletEntryDirection.STAFF_DEBIT, WalletEntryDirection.STAFF_CREDIT] },
        ...(query.sellerId === undefined ? {} : { sellerId: query.sellerId }),
      },
      orderBy: { id: 'desc' },
      take,
      select: {
        id: true,
        sellerId: true,
        direction: true,
        amount: true,
        runningBalanceAfter: true,
        note: true,
        actorId: true,
        createdAt: true,
        seller: { select: { companyName: true } },
      },
    });
    if (entries.length === 0) return { items: [] };
    const ids = entries.map((e) => e.id);
    const actorIds = [...new Set(entries.flatMap((e) => (e.actorId === null ? [] : [e.actorId])))];
    const [staff, audits, pairs] = await Promise.all([
      this.prisma.client.staffUser.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, emailDisplay: true },
      }),
      this.prisma.client.auditLog.findMany({
        where: { action: AUDIT_ACTION, entityId: { in: ids } },
        select: { entityId: true, metadata: true },
      }),
      this.prisma.client.bankEntry.findMany({
        where: {
          reference: { in: ids },
          type: BankEntryType.RECLASSIFICATION,
          ownerKind: BankOwnerKind.SELLER,
        },
        select: {
          reference: true,
          signedAmount: true,
          currency: true,
          account: { select: { label: true } },
        },
      }),
    ]);
    const staffBy = new Map(staff.map((s) => [s.id, s.emailDisplay]));
    const noteBy = new Map<string, string | null>();
    for (const a of audits) {
      const m = a.metadata as Record<string, unknown> | null;
      const note = m?.['internalNote'];
      if (a.entityId !== null) noteBy.set(a.entityId, typeof note === 'string' ? note : null);
    }
    return {
      items: entries.map((e) => ({
        id: e.id,
        sellerId: e.sellerId,
        companyName: e.seller.companyName,
        direction: e.direction === WalletEntryDirection.STAFF_DEBIT ? 'DEBIT' : 'CREDIT',
        amountInr: e.amount.toFixed(2),
        walletAfterInr: e.runningBalanceAfter.toFixed(2),
        reason: e.note,
        internalNote: noteBy.get(e.id) ?? null,
        staff: e.actorId === null ? null : (staffBy.get(e.actorId) ?? null),
        accounts: pairs
          .filter((p) => p.reference === e.id)
          .map((p) => ({
            label: p.account.label,
            amount: `${p.signedAmount.abs().toFixed(2)} ${p.currency}`,
          })),
        createdAt: e.createdAt,
      })),
    };
  }

  /** Sellers a transfer can be made to, by name or email. */
  async searchSellers(
    q: string,
  ): Promise<{ items: Array<{ id: string; companyName: string; email: string }> }> {
    const term = q.trim();
    const rows = await this.prisma.client.seller.findMany({
      where: {
        deletedAt: null,
        status: { in: [...TRANSFERABLE] },
        ...(term === ''
          ? {}
          : {
              OR: [
                { companyName: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
              ],
            }),
      },
      orderBy: { companyName: 'asc' },
      take: 20,
      select: { id: true, companyName: true, email: true },
    });
    return { items: rows };
  }

  /**
   * What the form needs before a preview: the seller's wallet and holdings,
   * and every rupee account with what is ours and what is theirs in it.
   */
  async context(sellerId: string): Promise<{
    seller: { id: string; companyName: string; status: SellerStatus };
    walletInr: string;
    heldInr: string;
    accounts: Array<{ accountId: string; label: string; capitalInr: string; sellerInr: string }>;
  }> {
    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: { id: true, companyName: true, status: true },
    });
    if (!seller) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'No such seller' });
    }
    const [last, holdings, accounts] = await Promise.all([
      this.prisma.client.sellerWalletEntry.findFirst({
        where: { sellerId, currency: Currency.INR },
        orderBy: { id: 'desc' },
        select: { runningBalanceAfter: true },
      }),
      this.prisma.client.bankEntry.groupBy({
        by: ['accountId', 'currency'],
        where: { sellerId, ownerKind: BankOwnerKind.SELLER, account: { deletedAt: null } },
        _sum: { signedAmount: true, inrBookValue: true },
      }),
      this.prisma.client.platformBankAccount.findMany({
        where: { currency: Currency.INR, deletedAt: null },
        orderBy: { displayOrder: 'asc' },
        select: { id: true, label: true },
      }),
    ]);
    const held = holdings.reduce((t, h) => {
      const units = h._sum.signedAmount ?? ZERO;
      const book = h.currency === Currency.INR ? units : (h._sum.inrBookValue ?? ZERO);
      return units.greaterThan(0) ? t.add(book) : t;
    }, ZERO);
    const rows = await Promise.all(
      accounts.map(async (a) => ({
        accountId: a.id,
        label: a.label,
        capitalInr: (await this.ledger.ownerBalance(a.id, { kind: BankOwnerKind.CAPITAL })).toFixed(
          2,
        ),
        sellerInr: (
          await this.ledger.ownerBalance(a.id, { kind: BankOwnerKind.SELLER, sellerId })
        ).toFixed(2),
      })),
    );
    return {
      seller,
      walletInr: (last?.runningBalanceAfter ?? ZERO).toFixed(2),
      heldInr: held.toFixed(2),
      accounts: rows,
    };
  }
}
