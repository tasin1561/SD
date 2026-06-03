import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ActorType,
  Currency,
  OnboardingStepActor,
  Prisma,
  SellerOnboardingStep,
  SellerStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  SellerOnboardingService,
  type OnboardingProgressView,
} from '../../seller-onboarding/services/seller-onboarding.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { UpdateSellerProfileDto } from '../dto/update-profile.dto';
import type { UpdateSellerBankDetailsDto } from '../dto/update-bank-details.dto';
import { BankAccountCipherService } from './bank-account-cipher.service';

export interface SellerProfileView {
  id: string;
  email: string;
  emailDisplay: string;
  companyName: string;
  contactPersonName: string;
  phone: string;
  whatsapp: string | null;
  status: SellerStatus;
  approvedAt: Date | null;
  displayCurrency: Currency;
  displayLanguage: string;
  countryCode: string;
  emailVerifiedAt: Date | null;
  bankName: string | null;
  bankAccountName: string | null;
  /**
   * MASKED display — the plaintext last-4 of the account number (or
   * the full account number if it's ≤4 chars). The full account
   * number is NEVER returned by the read endpoints; only the
   * remittance form's bank-account-snapshot capture and a future
   * admin-reveal endpoint decrypt it.
   */
  bankAccountNumber: string | null;
  bankRoutingNumber: string | null;
  bankSwiftCode: string | null;
  createdAt: Date;
  onboarding: OnboardingProgressView;
}

const PROFILE_SELECT = {
  id: true,
  email: true,
  emailDisplay: true,
  companyName: true,
  contactPersonName: true,
  phone: true,
  whatsapp: true,
  status: true,
  approvedAt: true,
  displayCurrency: true,
  displayLanguage: true,
  countryCode: true,
  emailVerifiedAt: true,
  bankName: true,
  bankAccountName: true,
  // Plaintext last-4 (or the full value when length <=4). The
  // ENCRYPTED column `bankAccountNumber` is intentionally NOT in
  // the read projection — the masked column is the only thing
  // clients see.
  bankAccountNumberMasked: true,
  bankRoutingNumber: true,
  bankSwiftCode: true,
  createdAt: true,
} as const;

@Injectable()
export class SellerProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly onboarding: SellerOnboardingService,
    private readonly bankCipher: BankAccountCipherService,
  ) {}

  async getProfile(sellerId: string): Promise<SellerProfileView> {
    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: PROFILE_SELECT,
    });
    if (!seller) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Seller session no longer valid',
      });
    }
    const onboarding = await this.onboarding.getProgress(sellerId);
    // Surface the masked field as `bankAccountNumber` in the API view.
    // The ENCRYPTED column is intentionally unreachable from the read
    // path; only the cipher service can decrypt it.
    const { bankAccountNumberMasked, ...rest } = seller;
    return {
      ...rest,
      bankAccountNumber: bankAccountNumberMasked,
      onboarding,
    };
  }

  async updateProfile(
    sellerId: string,
    input: UpdateSellerProfileDto,
    ctx: ClientContext,
  ): Promise<SellerProfileView> {
    const data: Prisma.SellerUpdateInput = {};
    const changes: Record<string, string | null> = {};

    if (input.companyName !== undefined) {
      data.companyName = input.companyName;
      changes['companyName'] = input.companyName;
    }
    if (input.contactPersonName !== undefined) {
      data.contactPersonName = input.contactPersonName;
      changes['contactPersonName'] = input.contactPersonName;
    }
    if (input.phone !== undefined) {
      data.phone = input.phone;
      changes['phone'] = input.phone;
    }
    if (input.whatsapp !== undefined) {
      data.whatsapp = input.whatsapp;
      changes['whatsapp'] = input.whatsapp;
    }
    if (input.displayCurrency !== undefined) {
      data.displayCurrency = input.displayCurrency as Currency;
      changes['displayCurrency'] = input.displayCurrency;
    }
    if (input.displayLanguage !== undefined) {
      data.displayLanguage = input.displayLanguage;
      changes['displayLanguage'] = input.displayLanguage;
    }

    if (Object.keys(changes).length === 0) {
      return this.getProfile(sellerId);
    }

    await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.seller.findFirst({
        where: { id: sellerId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
      }
      await tx.seller.update({ where: { id: sellerId }, data });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'seller.profile.updated',
          entityType: 'seller',
          entityId: sellerId,
          // Cast: changes may include explicit null for cleared fields,
          // which Prisma's InputJsonValue type rejects but JSONB accepts.
          changes: changes as Prisma.InputJsonValue,
          metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId },
        },
        tx,
      );
    });

    return this.getProfile(sellerId);
  }

  async updateBankDetails(
    sellerId: string,
    input: UpdateSellerBankDetailsDto,
    ctx: ClientContext,
  ): Promise<SellerProfileView> {
    const data: Prisma.SellerUpdateInput = {};
    const changes: Record<string, string | null> = {};

    const fields: Array<keyof UpdateSellerBankDetailsDto> = [
      'bankName',
      'bankAccountName',
      'bankAccountNumber',
      'bankRoutingNumber',
      'bankSwiftCode',
    ];

    for (const f of fields) {
      const value = input[f];
      if (value !== undefined) {
        if (f === 'bankAccountNumber') {
          // Phase 1B #2 — encrypt at rest. The cipher returns a
          // ciphertext blob + plaintext last-4 + key version. We store
          // all three; the masked is what reads return, the version is
          // how a future decrypt path picks the right env key.
          const enc = this.bankCipher.encrypt(value);
          data.bankAccountNumber = enc.storedValue;
          data.bankAccountNumberMasked = enc.masked;
          data.bankAccountNumberKeyVersion = enc.keyVersion;
        } else {
          // Mark for update; value can be string or null (null clears the field).
          (data as Record<string, string | null>)[f] = value;
        }
        // Never log the bank-detail values themselves to audit — only the
        // field names that changed. KYC/PII is not put into audit_logs.
        changes[f] = value === null ? null : 'updated';
      }
    }

    if (Object.keys(changes).length === 0) {
      return this.getProfile(sellerId);
    }

    const allRequiredPresentAfterUpdate = await this.prisma.client.$transaction(
      async (tx) => {
        const existing = await tx.seller.findFirst({
          where: { id: sellerId, deletedAt: null },
          select: {
            id: true,
            bankName: true,
            bankAccountName: true,
            bankAccountNumber: true,
          },
        });
        if (!existing) {
          throw new NotFoundException({
            code: 'SELLER_NOT_FOUND',
            message: 'Seller not found',
          });
        }
        const updated = await tx.seller.update({
          where: { id: sellerId },
          data,
          select: {
            bankName: true,
            bankAccountName: true,
            bankAccountNumber: true,
          },
        });
        await this.audit.log(
          {
            actorType: ActorType.SELLER,
            sellerId,
            action: 'seller.bank_details.updated',
            entityType: 'seller',
            entityId: sellerId,
            changes,
            metadata: {
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
              requestId: ctx.requestId,
            },
          },
          tx,
        );

        const ready =
          !!updated.bankName &&
          !!updated.bankAccountName &&
          !!updated.bankAccountNumber;

        if (ready) {
          await this.onboarding.markStepComplete(
            sellerId,
            SellerOnboardingStep.BANK_DETAILS_ADDED,
            OnboardingStepActor.SELLER,
            undefined,
            tx,
          );
        }
        return ready;
      },
    );

    // Mark onboarding metadata for future use; no-op for ready=false.
    void allRequiredPresentAfterUpdate;

    return this.getProfile(sellerId);
  }
}
