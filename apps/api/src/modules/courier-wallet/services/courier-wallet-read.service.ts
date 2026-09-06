import { Injectable } from '@nestjs/common';
import { BankEntryType, CourierRechargeMatch, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface CourierWalletAccountView {
  readonly courierAccountId: string;
  readonly label: string;
  readonly courierCode: string;
  readonly balanceInr: string | null;
  readonly capturedAt: string | null;
  readonly statedCreditInr: string | null;
  readonly statedDebitInr: string | null;
  readonly unrecordedCount: number;
  readonly mismatchCount: number;
}

export interface CourierRechargeView {
  readonly id: string;
  readonly courierAccountId: string;
  readonly accountLabel: string;
  readonly externalTxnId: string;
  readonly bankTxnRef: string | null;
  readonly amountInr: string;
  readonly status: string;
  readonly occurredAt: string;
  readonly matchState: CourierRechargeMatch;
  readonly bankEntryId: string | null;
  readonly bankAmountInr: string | null;
  readonly bankAccountLabel: string | null;
  readonly resolutionNote: string | null;
  readonly resolvedAt: string | null;
}

export interface UnmatchedPaymentView {
  readonly bankEntryId: string;
  readonly accountLabel: string;
  readonly amountInr: string;
  readonly reference: string | null;
  readonly occurredAt: string;
  readonly note: string | null;
}

/**
 * What the two sides of the courier wallet look like, side by side.
 *
 * Read-only and deliberately unopinionated: it reports the state the
 * reconciliation left, rather than re-deciding it. The sweep is the one
 * place that judges a match, so a page that also judged could show a
 * different answer to the same question depending on which ran last.
 */
@Injectable()
export class CourierWalletReadService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every courier account, with its most recent balance reading. */
  async accounts(): Promise<readonly CourierWalletAccountView[]> {
    const rows = await this.prisma.client.courierAccount.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        label: true,
        courier: { select: { code: true } },
        walletBalances: {
          orderBy: { capturedAt: 'desc' },
          take: 1,
          select: { balanceInr: true, capturedAt: true, totalCreditInr: true, totalDebitInr: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const counts = await this.prisma.client.courierWalletRecharge.groupBy({
      by: ['courierAccountId', 'matchState'],
      _count: { _all: true },
    });

    return rows.map((a) => {
      const latest = a.walletBalances[0];
      const count = (state: CourierRechargeMatch): number =>
        counts.find((c) => c.courierAccountId === a.id && c.matchState === state)?._count._all ?? 0;
      return {
        courierAccountId: a.id,
        label: a.label,
        courierCode: a.courier.code,
        // Null rather than zero when we have never read it. "We do not
        // know" and "it is empty" call for opposite reactions.
        balanceInr: latest?.balanceInr.toFixed(2) ?? null,
        capturedAt: latest?.capturedAt.toISOString() ?? null,
        statedCreditInr: latest?.totalCreditInr?.toFixed(2) ?? null,
        statedDebitInr: latest?.totalDebitInr?.toFixed(2) ?? null,
        unrecordedCount: count(CourierRechargeMatch.UNRECORDED),
        mismatchCount: count(CourierRechargeMatch.AMOUNT_MISMATCH),
      };
    });
  }

  /**
   * The recharges themselves.
   *
   * Defaults to everything needing attention rather than everything:
   * the answerable question on this page is "what is not reconciled",
   * and a list led by two hundred matched rows buries the four that
   * are not.
   */
  async recharges(filter: {
    readonly matchState?: CourierRechargeMatch;
    readonly courierAccountId?: string;
    readonly limit?: number;
  }): Promise<readonly CourierRechargeView[]> {
    const where: Prisma.CourierWalletRechargeWhereInput = {
      ...(filter.matchState === undefined ? {} : { matchState: filter.matchState }),
      ...(filter.courierAccountId === undefined
        ? {}
        : { courierAccountId: filter.courierAccountId }),
    };
    const rows = await this.prisma.client.courierWalletRecharge.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: Math.min(filter.limit ?? 200, 500),
      select: {
        id: true,
        courierAccountId: true,
        externalTxnId: true,
        bankTxnRef: true,
        amountInr: true,
        status: true,
        occurredAt: true,
        matchState: true,
        bankEntryId: true,
        resolutionNote: true,
        resolvedAt: true,
        courierAccount: { select: { label: true } },
        bankEntry: {
          select: { signedAmount: true, account: { select: { label: true } } },
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      courierAccountId: r.courierAccountId,
      accountLabel: r.courierAccount.label,
      externalTxnId: r.externalTxnId,
      bankTxnRef: r.bankTxnRef,
      amountInr: r.amountInr.toFixed(2),
      status: r.status,
      occurredAt: r.occurredAt.toISOString(),
      matchState: r.matchState,
      bankEntryId: r.bankEntryId,
      bankAmountInr: r.bankEntry?.signedAmount.abs().toFixed(2) ?? null,
      bankAccountLabel: r.bankEntry?.account.label ?? null,
      resolutionNote: r.resolutionNote,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Our side with nothing to show for it: money booked as a wallet
   * recharge that no recharge at the courier accounts for.
   *
   * This is the scam-shaped direction and it is listed WITHOUT an age
   * filter, unlike the alert — a payment made this afternoon is not yet
   * a problem, but somebody looking at this page should still see it.
   */
  async unmatchedPayments(): Promise<readonly UnmatchedPaymentView[]> {
    const rows = await this.prisma.client.bankEntry.findMany({
      where: { type: BankEntryType.COURIER_WALLET_RECHARGE, courierRecharge: { is: null } },
      orderBy: { occurredAt: 'desc' },
      take: 200,
      select: {
        id: true,
        signedAmount: true,
        reference: true,
        occurredAt: true,
        note: true,
        account: { select: { label: true } },
      },
    });
    return rows.map((e) => ({
      bankEntryId: e.id,
      accountLabel: e.account.label,
      amountInr: e.signedAmount.abs().toFixed(2),
      reference: e.reference,
      occurredAt: e.occurredAt.toISOString(),
      note: e.note,
    }));
  }
}
