import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ActorType,
  BankChangeStatus,
  Currency,
  OnboardingStepActor,
  Prisma,
  SellerOnboardingStep,
  SellerStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  SellerOnboardingService,
  type OnboardingProgressView,
} from '../../seller-onboarding/services/seller-onboarding.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { UpdateSellerProfileDto } from '../dto/update-profile.dto';
import type { UpdateSellerBankDetailsDto } from '../dto/update-bank-details.dto';
import { BankAccountCipherService } from './bank-account-cipher.service';

/** PENDING or REJECTED only — an APPROVED change IS the live account. */
export interface SellerBankChangeView {
  readonly id: string;
  readonly status: 'PENDING' | 'REJECTED';
  readonly submittedAt: Date;
  readonly decidedAt: Date | null;
  readonly decisionReason: string | null;
  readonly proposed: {
    readonly bankName: string;
    readonly bankBranchName: string;
    readonly bankAccountName: string;
    /** MASKED. The encrypted column is unreachable from any read path. */
    readonly bankAccountNumber: string;
    readonly bankRoutingNumber: string;
    readonly bankSwiftCode: string;
  };
}

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
  bankBranchName: string | null;
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
  logoUrl: string | null;
  logoMimeType: string | null;
  createdAt: Date;
  onboarding: OnboardingProgressView;
  latestBankChange: SellerBankChangeView | null;
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
  bankBranchName: true,
  bankAccountName: true,
  // Plaintext last-4 (or the full value when length <=4). The
  // ENCRYPTED column `bankAccountNumber` is intentionally NOT in
  // the read projection — the masked column is the only thing
  // clients see.
  bankAccountNumberMasked: true,
  bankRoutingNumber: true,
  bankSwiftCode: true,
  logoUrl: true,
  // Needed to presign a readable URL — the stored logoUrl is a pointer
  // to a private object, not a fetchable link.
  logoStorageKey: true,
  logoMimeType: true,
  createdAt: true,
} as const;

/**
 * The six columns that make up a payable bank account, in the order the
 * seller sees them on the form — so the "missing: …" list reads down the
 * card rather than in some internal order.
 *
 * They are ALL-OR-NOTHING. Not "a profile cannot be saved without bank
 * details" — a new seller legitimately has none, and the dashboard
 * checklist treats adding them as a later step — but "a half-entered
 * account is not a thing you can have". A payout missing a branch or a
 * SWIFT code does not fail at save time where someone could fix it; it
 * fails days later at the bank, and is discovered by whoever is chasing
 * the money.
 *
 * The labels are the seller's words, not the column names: the message
 * has to be actionable by the person reading it on the form.
 */
const BANK_FIELDS = [
  ['bankName', 'bank name'],
  ['bankBranchName', 'branch name'],
  ['bankAccountName', 'account holder name'],
  ['bankAccountNumber', 'account number'],
  ['bankRoutingNumber', 'routing number'],
  ['bankSwiftCode', 'SWIFT code'],
] as const satisfies ReadonlyArray<readonly [keyof UpdateSellerBankDetailsDto, string]>;

@Injectable()
export class SellerProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly onboarding: SellerOnboardingService,
    private readonly bankCipher: BankAccountCipherService,
    private readonly spaces: SpacesService,
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

    // The seller's own view of a change they asked for. PENDING so they
    // know it is not live and payouts still go to the old account;
    // REJECTED so they read the reason and can send a corrected one.
    // APPROVED rows are deliberately absent — the values are simply the
    // live ones by then, and surfacing them would say "pending" about
    // something already done.
    const change = await this.prisma.client.sellerBankChangeRequest.findFirst({
      where: {
        sellerId,
        status: { in: [BankChangeStatus.PENDING, BankChangeStatus.REJECTED] },
      },
      orderBy: { submittedAt: 'desc' },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        decidedAt: true,
        decisionReason: true,
        bankName: true,
        bankBranchName: true,
        bankAccountName: true,
        // MASKED only. The encrypted column is unreachable from any read
        // path, exactly as it is for the live account above.
        bankAccountNumberMasked: true,
        bankRoutingNumber: true,
        bankSwiftCode: true,
      },
    });
    // Surface the masked field as `bankAccountNumber` in the API view.
    // The ENCRYPTED column is intentionally unreachable from the read
    // path; only the cipher service can decrypt it.
    const { bankAccountNumberMasked, logoStorageKey, ...rest } = seller;
    return {
      ...rest,
      // Minted per request for the authenticated owner of this profile;
      // the column holds a pointer to a private object.
      logoUrl: logoStorageKey ? await this.spaces.presignGetUrl(logoStorageKey) : null,
      bankAccountNumber: bankAccountNumberMasked,
      onboarding,
      latestBankChange:
        change === null
          ? null
          : {
              id: change.id,
              status: change.status === BankChangeStatus.PENDING ? 'PENDING' : 'REJECTED',
              submittedAt: change.submittedAt,
              decidedAt: change.decidedAt,
              decisionReason: change.decisionReason,
              proposed: {
                bankName: change.bankName,
                bankBranchName: change.bankBranchName,
                bankAccountName: change.bankAccountName,
                bankAccountNumber: change.bankAccountNumberMasked,
                bankRoutingNumber: change.bankRoutingNumber,
                bankSwiftCode: change.bankSwiftCode,
              },
            },
    };
  }

  async updateProfile(
    sellerId: string,
    input: UpdateSellerProfileDto,
    ctx: ClientContext,
  ): Promise<SellerProfileView> {
    const data: Prisma.SellerUpdateInput = {};
    const changes: Record<string, string | null> = {};

    // companyName and phone are not here, and not on the DTO either:
    // they are the identity the account was approved on, so a seller
    // cannot rewrite them after the fact. Changing one is a support
    // request with a record, not a self-service edit.
    if (input.contactPersonName !== undefined) {
      data.contactPersonName = input.contactPersonName;
      changes['contactPersonName'] = input.contactPersonName;
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
          metadata: {
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
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
    /** The patch, normalised: what each named field will hold after the write. */
    const patched = new Map<keyof UpdateSellerBankDetailsDto, string | null>();
    /** The encrypted account number, kept as plain values: `data` is a
     *  Prisma update input and cannot be read back as a string. */
    // Nullable throughout: encrypting a cleared field returns nulls,
    // which is how "remove my account" is expressed.
    let encAccount: {
      stored: string | null;
      masked: string | null;
      keyVersion: number | null;
    } | null = null;

    for (const [f] of BANK_FIELDS) {
      const raw = input[f];
      if (raw !== undefined) {
        // A whitespace-only value is neither "set" nor "cleared" — it
        // would satisfy the completeness check below while being useless
        // to a bank. Collapse it to null so there is one representation
        // of "this field is empty".
        const value = raw === null || raw.trim() === '' ? null : raw.trim();
        patched.set(f, value);
        if (f === 'bankAccountNumber') {
          // Phase 1B #2 — encrypt at rest. The cipher returns a
          // ciphertext blob + plaintext last-4 + key version. We store
          // all three; the masked is what reads return, the version is
          // how a future decrypt path picks the right env key.
          const enc = this.bankCipher.encrypt(value);
          encAccount = { stored: enc.storedValue, masked: enc.masked, keyVersion: enc.keyVersion };
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

    await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.seller.findFirst({
        where: { id: sellerId, deletedAt: null },
        select: {
          id: true,
          bankName: true,
          bankBranchName: true,
          bankAccountName: true,
          bankAccountNumber: true,
          bankRoutingNumber: true,
          bankSwiftCode: true,
        },
      });
      if (!existing) {
        throw new NotFoundException({
          code: 'SELLER_NOT_FOUND',
          message: 'Seller not found',
        });
      }

      // ALL-OR-NOTHING, checked against the MERGE of this patch onto the
      // stored row — the request carries only the fields the seller
      // edited, so the patch alone cannot tell you whether the account
      // ends up payable. Read inside the same transaction as the write
      // so a concurrent edit cannot slip a field out between the check
      // and the UPDATE.
      //
      // The rule bites on SAVE, never on LOAD: a seller whose row
      // already holds partial details (they predate this rule) can still
      // open and edit their profile — they just cannot leave it partial.
      const missing = BANK_FIELDS.filter(([f]) => {
        const effective = patched.has(f) ? (patched.get(f) ?? null) : existing[f];
        return effective === null || effective === '';
      });
      // Nothing filled at all is the valid "remove my account" state;
      // everything filled is the valid payable state. Only the middle is
      // refused.
      if (missing.length > 0 && missing.length < BANK_FIELDS.length) {
        throw new BadRequestException({
          code: 'BANK_DETAILS_INCOMPLETE',
          message:
            'Bank details are all-or-nothing — a payout missing one field fails at the bank, days after anyone could have fixed it. ' +
            `Still needed: ${missing.map(([, label]) => label).join(', ')}. ` +
            'Fill these in, or clear all six fields to remove the account.',
        });
      }

      // ── FIRST ADD writes; an EDIT asks ──────────────────────────
      //
      // A seller with no account on file has nothing to redirect, so the
      // first set of details saves straight through. Every change after
      // that goes to an admin: anyone who got into a seller's account
      // could otherwise point payouts at their own bank, and the seller
      // would find out when the money did not arrive.
      //
      // "On file" means a payable account exists — all six present. A row
      // left partial by the pre-rule era is not an account anyone could
      // have been paid into, so completing it is a first add, not a
      // redirect.
      const hadAccountOnFile = BANK_FIELDS.every(([f]) => {
        const v = existing[f];
        return v !== null && v !== '';
      });
      // Clearing the account is not a redirect either — there is nowhere
      // for the money to go, so nothing to steal. It writes through.
      const isRemoval = BANK_FIELDS.every(([f]) => {
        const effective = patched.has(f) ? (patched.get(f) ?? null) : existing[f];
        return effective === null || effective === '';
      });

      if (hadAccountOnFile && !isRemoval) {
        try {
          await tx.sellerBankChangeRequest.create({
            data: {
              sellerId,
              bankName: String(patched.get('bankName') ?? existing.bankName ?? ''),
              bankBranchName: String(
                patched.get('bankBranchName') ?? existing.bankBranchName ?? '',
              ),
              bankAccountName: String(
                patched.get('bankAccountName') ?? existing.bankAccountName ?? '',
              ),
              // Encrypted with the same cipher as the live column, and
              // carrying its own masked copy — a request row must never
              // be where plaintext leaks.
              bankAccountNumber: encAccount?.stored ?? existing.bankAccountNumber ?? '',
              bankAccountNumberMasked: encAccount?.masked ?? '',
              ...(encAccount?.keyVersion == null
                ? {}
                : { bankAccountNumberKeyVersion: encAccount.keyVersion }),
              bankRoutingNumber: String(
                patched.get('bankRoutingNumber') ?? existing.bankRoutingNumber ?? '',
              ),
              bankSwiftCode: String(patched.get('bankSwiftCode') ?? existing.bankSwiftCode ?? ''),
            },
          });
        } catch (err) {
          // The partial unique index is the ONE-AT-A-TIME rule. It is a
          // constraint rather than a read-then-write check because two
          // concurrent submissions would both read "none pending" under
          // READ COMMITTED and both insert — the money-path shape this
          // codebase has had to fix before.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new ConflictException({
              code: 'BANK_CHANGE_ALREADY_PENDING',
              message:
                'You already have a bank change waiting for approval. One can be in review at a time — wait for that one to be approved or rejected before submitting another.',
            });
          }
          throw err;
        }

        await this.audit.log(
          {
            actorType: ActorType.SELLER,
            sellerId,
            action: 'seller.bank_details.change_requested',
            entityType: 'seller',
            entityId: sellerId,
            // HIGH: this is the first step of moving where money goes.
            severity: 'HIGH',
            changes,
            metadata: {
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
              requestId: ctx.requestId,
            },
          },
          tx,
        );
        // Deliberately NO seller.update — the live account is untouched
        // and payouts continue to it until an admin decides.
        return;
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

      // Past the check above these three are non-null only when all six
      // are, so this is "the account is payable" — which is what the
      // onboarding checklist means by the step being done.
      const ready = !!updated.bankName && !!updated.bankAccountName && !!updated.bankAccountNumber;

      if (ready) {
        await this.onboarding.markStepComplete(
          sellerId,
          SellerOnboardingStep.BANK_DETAILS_ADDED,
          OnboardingStepActor.SELLER,
          undefined,
          tx,
        );
      }
    });

    return this.getProfile(sellerId);
  }
}
