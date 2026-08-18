import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, BankChangeStatus } from '@skydrop/db';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { NotificationRecipientType } from '@skydrop/db';
import { EmailQueue } from '../../email/queue/email.queue';
import { EnvService } from '../../../config/env.service';
import { accountForDisplay } from '../../seller-profile/services/bank-account-carry';
import { BankAccountCipherService } from '../../seller-profile/services/bank-account-cipher.service';

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
  /**
   * In FULL, on both sides.
   *
   * The admin's whole job on this screen is to decide whether the new
   * destination is one they recognise, against a document the seller
   * sent. Four digits cannot answer that — two different accounts share
   * them often enough that a masked comparison is theatre. Reaching this
   * endpoint already requires `sellers.bank_change.approve`.
   */
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
    private readonly cipher: BankAccountCipherService,
    private readonly email: EmailQueue,
    private readonly env: EnvService,
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
        bankAccountNumber: true,
        bankAccountNumberKeyVersion: true,
        bankAccountNumberMasked: true,
        bankRoutingNumber: true,
        bankSwiftCode: true,
        seller: {
          select: {
            companyName: true,
            bankName: true,
            bankBranchName: true,
            bankAccountName: true,
            bankAccountNumber: true,
            bankAccountNumberKeyVersion: true,
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
        // Both sides in full, so "did the destination actually move" is
        // answerable by looking rather than inferred from four digits.
        current: {
          bankName: r.seller.bankName ?? '',
          bankBranchName: r.seller.bankBranchName ?? '',
          bankAccountName: r.seller.bankAccountName ?? '',
          bankAccountNumber:
            this.cipher.reveal(r.seller.bankAccountNumber, r.seller.bankAccountNumberKeyVersion) ??
            r.seller.bankAccountNumberMasked ??
            '',
          bankRoutingNumber: r.seller.bankRoutingNumber ?? '',
          bankSwiftCode: r.seller.bankSwiftCode ?? '',
        },
        proposed: {
          bankName: r.bankName,
          bankBranchName: r.bankBranchName,
          bankAccountName: r.bankAccountName,
          // A request that leaves the account number alone shows the LIVE
          // one, so the column reads "still going here" rather than a dash
          // the admin has to interpret. Decrypting the request's own copy
          // is wrong for pre-2026-08-18 rows: they carry the ciphertext
          // without its key version, and reveal() would hand back the raw
          // blob as though it were the number.
          bankAccountNumber: (() => {
            const shown = accountForDisplay(
              {
                stored: r.bankAccountNumber,
                masked: r.bankAccountNumberMasked,
                keyVersion: r.bankAccountNumberKeyVersion,
              },
              {
                stored: r.seller.bankAccountNumber,
                masked: r.seller.bankAccountNumberMasked,
                keyVersion: r.seller.bankAccountNumberKeyVersion,
              },
            );
            return this.cipher.reveal(shown.stored, shown.keyVersion) ?? shown.masked ?? '';
          })(),
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
          seller: {
            select: {
              bankAccountNumber: true,
              bankAccountNumberMasked: true,
              bankAccountNumberKeyVersion: true,
            },
          },
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
        // The account number moves as a TRIPLE — ciphertext, mask, key
        // version — or it does not move at all. A request that leaves the
        // number alone keeps the LIVE triple: copying its own carried
        // copy would be right for the ciphertext and wrong for the other
        // two on any request written before 2026-08-18, which lost them
        // on the way in. That writes a live account nothing can decrypt
        // and no screen can show, discovered when a payout fails.
        const live = {
          stored: req.seller.bankAccountNumber,
          masked: req.seller.bankAccountNumberMasked,
          keyVersion: req.seller.bankAccountNumberKeyVersion,
        };
        const account = accountForDisplay(
          {
            stored: req.bankAccountNumber,
            masked: req.bankAccountNumberMasked,
            keyVersion: req.bankAccountNumberKeyVersion,
          },
          live,
        );

        // A number with no mask is incoherent: every write path produces
        // both together, so one without the other means the row was
        // assembled by something that no longer exists. Refuse rather
        // than guess — rejecting costs the seller one resubmission, and
        // approving costs them their payouts.
        // A null key version is legitimate — it means the number predates
        // encryption and is stored as plaintext — so it is NOT part of
        // this check.
        if ((account.stored ?? '') === '' || (account.masked ?? '') === '') {
          throw new ConflictException({
            code: 'BANK_CHANGE_UNAPPROVABLE',
            message:
              'This request does not carry a complete account number, so approving it would leave the seller with payout details nobody can read. Reject it and ask the seller to submit the change again.',
          });
        }

        // The one place a change request reaches the live columns. The
        // ciphertext moves across as-is with its key version — decrypting
        // and re-encrypting would put the number in memory for no reason.
        await tx.seller.update({
          where: { id: req.sellerId },
          data: {
            bankName: req.bankName,
            bankBranchName: req.bankBranchName,
            bankAccountName: req.bankAccountName,
            bankAccountNumber: account.stored,
            bankAccountNumberMasked: account.masked,
            bankAccountNumberKeyVersion: account.keyVersion,
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

      // Tell the seller either way. An approval is the moment their money
      // starts going somewhere else, and a rejection is the moment they
      // need to know nothing moved and why — waiting for them to check a
      // page they have no reason to open is not telling them.
      //
      // Enqueued inside the decision tx, per this repo's status-change
      // convention: a rolled-back decision must not leave a job saying it
      // was made.
      const seller = await tx.seller.findUnique({
        where: { id: req.sellerId },
        select: { email: true, companyName: true },
      });
      if (seller !== null) {
        await this.email.enqueue({
          templateCode:
            status === BankChangeStatus.APPROVED
              ? 'seller.bank_change_approved.email'
              : 'seller.bank_change_rejected.email',
          recipient: {
            type: NotificationRecipientType.SELLER,
            id: req.sellerId,
            email: seller.email,
          },
          variables: {
            company_name: seller.companyName,
            support_email: this.env.supportEmail,
            app_url: this.env.sellerAppUrl,
            bank_name: req.bankName,
            // From the MASK, so the number itself never lands in a mailbox.
            account_last4: (req.bankAccountNumberMasked ?? '').replace(/\D/g, '').slice(-4),
            reason: reason ?? '',
          },
          triggerEvent:
            status === BankChangeStatus.APPROVED
              ? 'seller.bank_change.approved'
              : 'seller.bank_change.rejected',
        });
      }

      return { id, status: status === BankChangeStatus.APPROVED ? 'APPROVED' : 'REJECTED' };
    });
  }
}
