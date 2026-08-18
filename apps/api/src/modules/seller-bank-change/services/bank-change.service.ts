import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, BankChangeStatus } from '@skydrop/db';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

export interface BankChangeRequestView {
  readonly id: string;
  readonly sellerId: string;
  readonly companyName: string;
  readonly submittedAt: Date;
  readonly current: BankFieldsView;
  readonly proposed: BankFieldsView;
}

export interface BankChangeDecision {
  readonly id: string;
  readonly status: 'APPROVED' | 'REJECTED';
}

export interface BankFieldsView {
  readonly bankName: string;
  readonly bankBranchName: string;
  readonly bankAccountName: string;
  /** MASKED. The real number is never returned by any read path. */
  readonly bankAccountNumber: string;
  readonly bankRoutingNumber: string;
  readonly bankSwiftCode: string;
}

/**
 * Deciding whether a seller may move where their money is sent.
 *
 * The seller's own PATCH created a PENDING row and left the live columns
 * alone. This service is the ONLY thing that writes those columns from a
 * change request — which is what makes "approved" mean something.
 */
@Injectable()
export class BankChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async listPending(): Promise<{ items: BankChangeRequestView[] }> {
    const rows = await this.prisma.client.sellerBankChangeRequest.findMany({
      where: { status: BankChangeStatus.PENDING },
      orderBy: { submittedAt: 'asc' },
      select: {
        id: true,
        sellerId: true,
        submittedAt: true,
        bankName: true,
        bankBranchName: true,
        bankAccountName: true,
        bankAccountNumberMasked: true,
        bankRoutingNumber: true,
        bankSwiftCode: true,
        seller: {
          select: {
            companyName: true,
            bankName: true,
            bankBranchName: true,
            bankAccountName: true,
            bankAccountNumberMasked: true,
            bankRoutingNumber: true,
            bankSwiftCode: true,
          },
        },
      },
    });

    return {
      items: rows.map((r) => ({
        id: r.id,
        sellerId: r.sellerId,
        companyName: r.seller.companyName,
        submittedAt: r.submittedAt,
        // Both sides masked. Equal masks are NOT proof the account is
        // unchanged — two different numbers can end in the same four
        // digits — which is why the admin screen says so rather than
        // letting a reader infer it.
        current: {
          bankName: r.seller.bankName ?? '',
          bankBranchName: r.seller.bankBranchName ?? '',
          bankAccountName: r.seller.bankAccountName ?? '',
          bankAccountNumber: r.seller.bankAccountNumberMasked ?? '',
          bankRoutingNumber: r.seller.bankRoutingNumber ?? '',
          bankSwiftCode: r.seller.bankSwiftCode ?? '',
        },
        proposed: {
          bankName: r.bankName,
          bankBranchName: r.bankBranchName,
          bankAccountName: r.bankAccountName,
          bankAccountNumber: r.bankAccountNumberMasked,
          bankRoutingNumber: r.bankRoutingNumber,
          bankSwiftCode: r.bankSwiftCode,
        },
      })),
    };
  }

  async approve(id: string, staffId: string): Promise<BankChangeDecision> {
    return this.decide(id, staffId, BankChangeStatus.APPROVED, null);
  }

  async reject(id: string, staffId: string, reason: string): Promise<BankChangeDecision> {
    return this.decide(id, staffId, BankChangeStatus.REJECTED, reason.trim());
  }

  private async decide(
    id: string,
    staffId: string,
    // Typed as the enum itself: Prisma generates these as const objects,
    // so `BankChangeStatus.APPROVED` is a value and not a type. Only
    // approve()/reject() call this, and both pass a decided status.
    status: BankChangeStatus,
    reason: string | null,
  ): Promise<BankChangeDecision> {
    return this.prisma.client.$transaction(async (tx) => {
      const req = await tx.sellerBankChangeRequest.findUnique({
        where: { id },
        select: {
          id: true,
          sellerId: true,
          status: true,
          bankName: true,
          bankBranchName: true,
          bankAccountName: true,
          bankAccountNumber: true,
          bankAccountNumberMasked: true,
          bankAccountNumberKeyVersion: true,
          bankRoutingNumber: true,
          bankSwiftCode: true,
        },
      });
      if (req === null) {
        throw new NotFoundException({
          code: 'BANK_CHANGE_NOT_FOUND',
          message: 'No such bank change request.',
        });
      }

      // Claim it with a guarded updateMany rather than reading the status
      // above and trusting it: two admins opening the queue together
      // would both read PENDING and both proceed, and this one moves
      // money. `count === 0` means somebody else decided first.
      const claimed = await tx.sellerBankChangeRequest.updateMany({
        where: { id, status: BankChangeStatus.PENDING },
        data: {
          status,
          decidedByStaffId: staffId,
          decidedAt: new Date(),
          ...(reason === null ? {} : { decisionReason: reason }),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'BANK_CHANGE_ALREADY_DECIDED',
          message: 'Somebody already approved or rejected this request.',
        });
      }

      if (status === BankChangeStatus.APPROVED) {
        // The one place a change request reaches the live columns. The
        // ciphertext moves across as-is with its key version — decrypting
        // and re-encrypting would put the number in memory for no reason.
        await tx.seller.update({
          where: { id: req.sellerId },
          data: {
            bankName: req.bankName,
            bankBranchName: req.bankBranchName,
            bankAccountName: req.bankAccountName,
            bankAccountNumber: req.bankAccountNumber,
            bankAccountNumberMasked: req.bankAccountNumberMasked,
            bankAccountNumberKeyVersion: req.bankAccountNumberKeyVersion,
            bankRoutingNumber: req.bankRoutingNumber,
            bankSwiftCode: req.bankSwiftCode,
          },
        });
      }

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          actorId: staffId,
          sellerId: req.sellerId,
          action:
            status === BankChangeStatus.APPROVED
              ? 'staff.bank_change.approved'
              : 'staff.bank_change.rejected',
          entityType: 'seller_bank_change_request',
          entityId: id,
          // Approving redirects a seller's money. Nothing about that is
          // routine, and it has to be attributable years later.
          severity: 'HIGH',
          // The values themselves never enter audit_logs — only that a
          // decision happened, and why if it was refused.
          metadata: reason === null ? {} : { reason },
        },
        tx,
      );

      return { id, status: status === BankChangeStatus.APPROVED ? 'APPROVED' : 'REJECTED' };
    });
  }
}
