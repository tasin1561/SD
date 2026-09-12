import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  AuditSeverity,
  BankEntryType,
  BankOwnerKind,
  CourierRechargeMatch,
  Currency,
  Prisma,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  BankLedgerService,
  idempotencyKeyReused,
} from '../../treasury/services/bank-ledger.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { isUniqueViolation } from '../../../common/db/unique-violation';
import { lockAccountsForPosting } from '../../../common/db/advisory-lock';

/** The material fields a courier top-up's idempotency key vouches for. */
interface RechargeShape {
  readonly accountId: string;
  readonly signedAmount: Prisma.Decimal;
  readonly occurredAt: Date;
  readonly reference: string;
}

/**
 * The two ways a person answers the reconciliation.
 *
 * ── WHY THIS IS NOT JUST THE TREASURY'S RECORD-ENTRY FORM ────────────
 * It could be: post a `COURIER_WALLET_RECHARGE` entry with the right
 * reference, and the nightly sweep would pair them. But that leaves the
 * two facts joined only by a string somebody typed, and it is the string
 * that is easiest to get wrong — a transposed digit produces an entry
 * that never matches and a recharge that stays flagged, which reads as
 * two problems rather than one typo.
 *
 * Recording FROM the recharge takes the amount, the date and the
 * reference from the courier's own row and links the entry in the same
 * transaction. There is nothing left to mistype, and no window in which
 * the entry exists unlinked.
 *
 * ── AND WHY RESOLVING IS SEPARATE ────────────────────────────────────
 * Some unmatched recharges are not ours to book — a credit note, a
 * promotional top-up, a correction the courier made on their own side.
 * Saying so is a JUDGEMENT and is recorded as one: who, when, and why,
 * on the row, permanently. What it must never be is a way to make an
 * awkward number disappear, so it demands a real reason and audits
 * HIGH — the same treatment a write-off gets.
 */
@Injectable()
export class CourierWalletRecordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bank: BankLedgerService,
    private readonly audit: AuditLogService,
    private readonly issues: SystemIssueService,
  ) {}

  /**
   * "This recharge was paid from that account." Writes the bank side.
   *
   * TRE-1: the entry goes through `BankLedgerService.post()`, inside the
   * same transaction that links it — so an entry can never exist for a
   * recharge that did not get linked to it, which is the state that
   * would then look like a second unrecorded payment.
   */
  async recordBankSide(input: {
    readonly rechargeId: string;
    readonly bankAccountId: string;
    readonly staffId: string;
    readonly note?: string | null;
  }): Promise<{ bankEntryId: string }> {
    const recharge = await this.prisma.client.courierWalletRecharge.findUnique({
      where: { id: input.rechargeId },
      select: {
        id: true,
        courierAccountId: true,
        externalTxnId: true,
        bankTxnRef: true,
        amountInr: true,
        occurredAt: true,
        bankEntryId: true,
        courierAccount: { select: { label: true } },
      },
    });
    if (recharge === null) {
      throw new NotFoundException({
        code: 'RECHARGE_NOT_FOUND',
        message: 'No such courier wallet recharge',
      });
    }
    if (recharge.bankEntryId !== null) {
      // Refused rather than replaced: paying for the same recharge
      // twice in the books is the error this whole table exists to
      // find, and an endpoint that overwrote the link would create it.
      throw new ConflictException({
        code: 'RECHARGE_ALREADY_RECORDED',
        message: 'This recharge is already tied to a bank entry',
      });
    }

    const bankEntryId = await this.prisma.client.$transaction(async (tx) => {
      // The account's reconcile key (TRE-1): a reconcile of this account must
      // not read its balance between our read and our post.
      await lockAccountsForPosting(tx, [input.bankAccountId]);
      // Claim it FIRST, guarded on the link still being absent. Two
      // operators recording the same recharge from two screens both read
      // "not recorded" above; only one of them may write the money.
      const claimed = await tx.courierWalletRecharge.updateMany({
        where: { id: recharge.id, bankEntryId: null },
        data: {
          resolvedByStaffId: input.staffId,
          resolvedAt: new Date(),
          ...(input.note == null || input.note === '' ? {} : { resolutionNote: input.note }),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'RECHARGE_ALREADY_RECORDED',
          message: 'Somebody else recorded this recharge while you were on this page',
        });
      }

      const entry = await this.bank.post(
        {
          accountId: input.bankAccountId,
          type: BankEntryType.COURIER_WALLET_RECHARGE,
          // NEGATIVE: money left our bank. It has not left the business
          // — it is now the prepaid balance the treasury overview counts
          // as an asset — but the ACCOUNT is lighter by exactly this.
          signedAmount: recharge.amountInr.negated(),
          amountCurrency: Currency.INR,
          // Ours, not any seller's. The wallet buys waybills for
          // everyone's parcels; attributing it to a seller would move
          // their held cash for a payment they did not make.
          owner: { kind: BankOwnerKind.CAPITAL },
          actorType: ActorType.STAFF,
          staffId: input.staffId,
          occurredAt: recharge.occurredAt,
          reference: recharge.bankTxnRef,
          note:
            `Courier wallet recharge — ${recharge.courierAccount.label} ` +
            `(${recharge.externalTxnId})` +
            `${input.note == null || input.note === '' ? '' : ` — ${input.note}`}`,
        },
        tx,
      );

      await tx.courierWalletRecharge.update({
        where: { id: recharge.id },
        data: { bankEntryId: entry.id, matchState: CourierRechargeMatch.MATCHED },
      });
      return entry.id;
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: input.staffId,
      action: 'courier_wallet.recharge_recorded',
      entityType: 'courier_wallet_recharge',
      entityId: recharge.id,
      // Money entering the books on somebody's say-so. Not CRITICAL —
      // it is the correct, expected action — but never LOW.
      severity: AuditSeverity.HIGH,
      metadata: {
        courierAccountId: recharge.courierAccountId,
        externalTxnId: recharge.externalTxnId,
        amountInr: recharge.amountInr.toFixed(2),
        bankAccountId: input.bankAccountId,
        bankEntryId,
      },
    });

    // The alert asked for exactly this and has now had its answer.
    await this.issues.resolveByKey(
      `courier-recharge-unrecorded:${recharge.courierAccountId}:${recharge.externalTxnId}`,
      'Bank side recorded',
      input.staffId,
    );

    return { bankEntryId };
  }

  /**
   * "This one is not ours to book, and here is why."
   *
   * Leaves `bankEntryId` null on purpose — there is no money of ours
   * behind it, and inventing an entry to make the row look tidy would
   * put a number in the bank book that no statement will ever agree
   * with (the same reasoning as TRE-8's clamp).
   */
  async resolveWithoutPayment(input: {
    readonly rechargeId: string;
    readonly staffId: string;
    readonly reason: string;
  }): Promise<{ resolved: true }> {
    if (input.reason.trim().length < 20) {
      throw new BadRequestException({
        code: 'RESOLUTION_REASON_TOO_SHORT',
        message:
          'Say what this recharge was in at least 20 characters — this is the only ' +
          'record of why money at the courier has nothing of ours behind it',
      });
    }

    const recharge = await this.prisma.client.courierWalletRecharge.findUnique({
      where: { id: input.rechargeId },
      select: {
        id: true,
        courierAccountId: true,
        externalTxnId: true,
        amountInr: true,
        bankEntryId: true,
      },
    });
    if (recharge === null) {
      throw new NotFoundException({
        code: 'RECHARGE_NOT_FOUND',
        message: 'No such courier wallet recharge',
      });
    }
    if (recharge.bankEntryId !== null) {
      throw new ConflictException({
        code: 'RECHARGE_ALREADY_RECORDED',
        message: 'This recharge has a bank entry behind it — there is nothing to explain away',
      });
    }

    const claimed = await this.prisma.client.courierWalletRecharge.updateMany({
      where: {
        id: recharge.id,
        bankEntryId: null,
        matchState: { not: CourierRechargeMatch.RESOLVED },
      },
      data: {
        matchState: CourierRechargeMatch.RESOLVED,
        resolvedByStaffId: input.staffId,
        resolvedAt: new Date(),
        resolutionNote: input.reason.trim(),
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'RECHARGE_ALREADY_MOVED',
        message: 'This recharge was already answered by somebody else',
      });
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: input.staffId,
      action: 'courier_wallet.recharge_resolved_unpaid',
      entityType: 'courier_wallet_recharge',
      entityId: recharge.id,
      // A person declaring that money at the courier needs no payment of
      // ours. Rare, and exactly the shape somebody would use to bury a
      // recharge they should not have made.
      severity: AuditSeverity.HIGH,
      metadata: {
        courierAccountId: recharge.courierAccountId,
        externalTxnId: recharge.externalTxnId,
        amountInr: recharge.amountInr.toFixed(2),
        reason: input.reason.trim(),
      },
    });

    await this.issues.resolveByKey(
      `courier-recharge-unrecorded:${recharge.courierAccountId}:${recharge.externalTxnId}`,
      input.reason.trim(),
      input.staffId,
    );

    return { resolved: true };
  }

  /**
   * Record a payment we have JUST made, before the courier shows it.
   *
   * The other half of the loop, and the one that makes the whole thing
   * work: an operator who tops a wallet up records it here at the time,
   * so the sweep has something to match against tomorrow. If they do
   * not, the recharge turns up unrecorded and is flagged; if they record
   * one that never reaches the courier, `findPaidButNeverArrived` flags
   * that instead. Both directions are covered because both are written
   * down.
   */
  async recordOutgoingPayment(input: {
    readonly bankAccountId: string;
    readonly amountInr: string;
    readonly occurredAt: Date;
    readonly reference: string;
    readonly courierAccountId: string;
    readonly staffId: string;
    readonly note?: string | null;
    /**
     * The client's key for this request. A replay returns the entry the
     * first request posted and posts nothing — a double-click on "Record
     * it" must not book the same top-up twice, which would then read as
     * a payment that never reached the courier.
     */
    readonly idempotencyKey?: string | null;
  }): Promise<{ bankEntryId: string }> {
    const amount = new Prisma.Decimal(input.amountInr);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'A recharge is money going out — give the amount as a positive number',
      });
    }
    if (input.reference.trim() === '') {
      throw new BadRequestException({
        code: 'REFERENCE_REQUIRED',
        message:
          'The bank reference is what ties this to the courier’s own recharge row. ' +
          'Without it the payment can never be matched and will be flagged as missing.',
      });
    }

    // What this request would post — a replay must match it exactly.
    const expected: RechargeShape = {
      accountId: input.bankAccountId,
      signedAmount: amount.negated(),
      occurredAt: input.occurredAt,
      reference: input.reference.trim(),
    };
    const replay = await this.replayPayment(input.idempotencyKey, expected);
    if (replay !== null) return replay;

    const courierAccount = await this.prisma.client.courierAccount.findFirst({
      where: { id: input.courierAccountId, deletedAt: null },
      select: { id: true, label: true },
    });
    if (courierAccount === null) {
      throw new NotFoundException({
        code: 'COURIER_ACCOUNT_NOT_FOUND',
        message: 'No such courier account',
      });
    }

    let entry: { id: string };
    try {
      entry = await this.prisma.client.$transaction(async (tx) => {
        // The account's reconcile key (TRE-1): a reconcile of this account must
        // not read its balance between our read and our post.
        await lockAccountsForPosting(tx, [input.bankAccountId]);
        return this.bank.post(
          {
            accountId: input.bankAccountId,
            type: BankEntryType.COURIER_WALLET_RECHARGE,
            signedAmount: amount.negated(),
            amountCurrency: Currency.INR,
            owner: { kind: BankOwnerKind.CAPITAL },
            actorType: ActorType.STAFF,
            staffId: input.staffId,
            occurredAt: input.occurredAt,
            reference: input.reference.trim(),
            idempotencyKey: input.idempotencyKey ?? null,
            note:
              `Courier wallet recharge — ${courierAccount.label}` +
              `${input.note == null || input.note === '' ? '' : ` — ${input.note}`}`,
          },
          tx,
        );
      });
    } catch (err) {
      // The same request racing itself: answer with the winner's entry.
      if (input.idempotencyKey != null && isUniqueViolation(err)) {
        const again = await this.replayPayment(input.idempotencyKey, expected);
        if (again !== null) return again;
      }
      throw err;
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: input.staffId,
      action: 'courier_wallet.payment_recorded',
      entityType: 'courier_wallet_recharge',
      entityId: null,
      severity: AuditSeverity.HIGH,
      metadata: {
        courierAccountId: courierAccount.id,
        bankAccountId: input.bankAccountId,
        bankEntryId: entry.id,
        amountInr: amount.toFixed(2),
        reference: input.reference.trim(),
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    return { bankEntryId: entry.id };
  }

  /**
   * The entry a key already posted, or null for a new key. A key whose
   * entry is not THIS top-up — another type, account, amount, date or
   * reference — is a client bug, and is refused (IDEM-1) rather than
   * answered with an unrelated entry.
   */
  private async replayPayment(
    idempotencyKey: string | null | undefined,
    expected: RechargeShape,
  ): Promise<{ bankEntryId: string } | null> {
    if (idempotencyKey == null) return null;
    const prior = await this.prisma.client.bankEntry.findUnique({
      where: { idempotencyKey },
      select: {
        id: true,
        type: true,
        accountId: true,
        signedAmount: true,
        occurredAt: true,
        reference: true,
      },
    });
    if (prior === null) return null;
    if (
      prior.type !== BankEntryType.COURIER_WALLET_RECHARGE ||
      prior.accountId !== expected.accountId ||
      !prior.signedAmount.equals(expected.signedAmount) ||
      prior.occurredAt.getTime() !== expected.occurredAt.getTime() ||
      (prior.reference ?? '').trim() !== expected.reference
    ) {
      throw idempotencyKeyReused('courier wallet payment');
    }
    return { bankEntryId: prior.id };
  }
}
