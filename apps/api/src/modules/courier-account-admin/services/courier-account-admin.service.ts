import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ActorType, CredentialEnvironment, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { encryptCredential } from '../../courier-shared/util/courier-credential-cipher';
import type {
  CreateCourierAccountDto,
  LinkSellerCourierAccountDto,
  UpdateCourierAccountDto,
  UpdateSellerCourierAccountLinkDto,
} from '../dto/courier-account-admin.dto';

/** All new credentials are encrypted at this key version (mirrors
 *  bank-account-cipher.service.ts's CURRENT_KEY_VERSION convention). */
const CURRENT_KEY_VERSION = 1;

export interface CourierAccountView {
  readonly id: string;
  readonly courierCode: string;
  readonly environment: CredentialEnvironment;
  readonly label: string;
  readonly isDefault: boolean;
  readonly isActive: boolean;
  /**
   * What this account sends as `pickup_location.name`. Null means it
   * uses the global setting — which is correct for a single-account
   * setup and a thing to fill in the moment there are two.
   */
  readonly pickupLocationName: string | null;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SellerCourierAccountLinkView {
  readonly id: string;
  readonly sellerId: string;
  readonly courierAccountId: string;
  readonly distributionWeight: number;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

/**
 * R1 (revised-plan roadmap) — admin write path for CourierAccount +
 * SellerCourierAccountLink. Never returns `encryptedPayload` or any
 * decrypted value — credential plaintext only ever flows through
 * `CourierCredentialService` (CUR-1), and only at AWB/dispatch time.
 */
@Injectable()
export class CourierAccountAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly audit: AuditLogService,
  ) {}

  async createAccount(dto: CreateCourierAccountDto, staffId: string): Promise<CourierAccountView> {
    // ADOPTING an existing credential, or minting a new one.
    //
    // Adoption exists because an account created for a credential
    // ALREADY IN USE had no path: the only route was re-typing the
    // token, which mints a second active row for the same courier and
    // environment — and because the HTTP layer resolves through the
    // DEFAULT ACCOUNT once accounts exist, that silently SWAPS which
    // credential authenticates, from a proven one to a freshly typed
    // one. That is a bad trade at the best of times and a genuinely
    // dangerous one immediately before a first live write.
    const adopting = dto.adoptCredentialId !== undefined;

    let encryptedPayload = '';
    let fieldNames: string[] = [];
    if (!adopting) {
      const key = this.env.courierCredentialsKey(CURRENT_KEY_VERSION);
      if (key === '') {
        throw new BadRequestException({
          code: 'COURIER_CREDENTIALS_UNAVAILABLE',
          message: `COURIER_CREDENTIALS_KEY_V${CURRENT_KEY_VERSION} is not configured — cannot encrypt a new credential`,
        });
      }
      const fields = dto.credentialFields ?? {};
      fieldNames = Object.keys(fields);
      if (fieldNames.length === 0) {
        throw new BadRequestException({
          code: 'INVALID_CREDENTIAL_FIELDS',
          message: 'Provide credentialFields, or adoptCredentialId to reuse an existing credential',
        });
      }
      encryptedPayload = encryptCredential(JSON.stringify(fields), key);
    }

    return this.prisma.client.$transaction(async (tx) => {
      const courier = await tx.courier.findUnique({
        where: { code: dto.courierCode },
        select: { id: true },
      });
      if (!courier) {
        throw new NotFoundException({
          code: 'COURIER_NOT_FOUND',
          message: `Courier ${dto.courierCode} not found`,
        });
      }

      let credential: { id: string };
      if (dto.adoptCredentialId !== undefined) {
        const existing = await tx.courierCredential.findFirst({
          where: {
            id: dto.adoptCredentialId,
            courierId: courier.id,
            environment: dto.environment,
            isActive: true,
            deletedAt: null,
          },
          select: { id: true, fieldNames: true },
        });
        if (!existing) {
          // Deliberately one message for "no such row", "wrong courier",
          // "wrong environment" and "inactive": all four mean the same
          // thing to the caller — this is not a credential you may adopt
          // here — and enumerating which would let someone probe for
          // credential ids that exist.
          throw new NotFoundException({
            code: 'CREDENTIAL_NOT_ADOPTABLE',
            message: 'No active credential with that id for this courier and environment',
          });
        }
        // `courier_accounts.credential_id` is UNIQUE, so a credential
        // already carried by an account is refused by the database
        // rather than by a check that could race one.
        const taken = await tx.courierAccount.findUnique({
          where: { credentialId: existing.id },
          select: { id: true, label: true },
        });
        if (taken) {
          throw new ConflictException({
            code: 'CREDENTIAL_ALREADY_LINKED',
            message: `That credential already belongs to the account "${taken.label}"`,
          });
        }
        fieldNames = existing.fieldNames;
        credential = { id: existing.id };
      } else {
        credential = await tx.courierCredential.create({
          data: {
            courierId: courier.id,
            environment: dto.environment,
            encryptedPayload,
            encryptionKeyVersion: CURRENT_KEY_VERSION,
            fieldNames,
            isActive: true,
            createdByStaffId: staffId,
          },
          select: { id: true },
        });
      }

      if (dto.isDefault) {
        await this.clearOtherDefaults(tx, courier.id, dto.environment, null);
      }

      const account = await tx.courierAccount.create({
        data: {
          courierId: courier.id,
          environment: dto.environment,
          label: dto.label,
          credentialId: credential.id,
          isDefault: dto.isDefault ?? false,
          // Not trimmed: Delhivery matches this string exactly, and
          // silently "fixing" whitespace here would produce a name that
          // does not match the registration. The registration path
          // refuses an untrimmed name loudly instead.
          pickupLocationName: dto.pickupLocationName ?? null,
          notes: dto.notes ?? null,
          createdByStaffId: staffId,
        },
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'staff.courier_account.created',
          entityType: 'courier_account',
          entityId: account.id,
          metadata: {
            courierCode: dto.courierCode,
            environment: dto.environment,
            label: dto.label,
            isDefault: account.isDefault,
            fieldNames,
            // Which of the two paths ran. "Where did this account's
            // credential come from" is the first question asked when an
            // auth failure is traced back here.
            credentialSource: adopting ? 'ADOPTED_EXISTING' : 'NEW',
            credentialId: credential.id,
          },
          severity: 'MEDIUM',
        },
        tx,
      );

      return this.toView(account, dto.courierCode);
    });
  }

  async listAccounts(
    courierCode?: string,
    environment?: CredentialEnvironment,
  ): Promise<readonly CourierAccountView[]> {
    const rows = await this.prisma.client.courierAccount.findMany({
      where: {
        deletedAt: null,
        ...(courierCode === undefined ? {} : { courier: { code: courierCode } }),
        ...(environment === undefined ? {} : { environment }),
      },
      include: { courier: { select: { code: true } } },
      orderBy: [{ courierId: 'asc' }, { environment: 'asc' }, { label: 'asc' }],
    });
    return rows.map((r) => this.toView(r, r.courier.code));
  }

  async updateAccount(
    accountId: string,
    dto: UpdateCourierAccountDto,
    staffId: string,
  ): Promise<CourierAccountView> {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.courierAccount.findUnique({
        where: { id: accountId },
        include: { courier: { select: { code: true } } },
      });
      if (!existing || existing.deletedAt !== null) {
        throw new NotFoundException({
          code: 'COURIER_ACCOUNT_NOT_FOUND',
          message: `Courier account ${accountId} not found`,
        });
      }

      if (dto.isDefault === true && !existing.isDefault) {
        await this.clearOtherDefaults(tx, existing.courierId, existing.environment, accountId);
      }

      const updated = await tx.courierAccount.update({
        where: { id: accountId },
        data: {
          ...(dto.label === undefined ? {} : { label: dto.label }),
          ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
          ...(dto.isDefault === undefined ? {} : { isDefault: dto.isDefault }),
          ...(dto.pickupLocationName === undefined
            ? {}
            : { pickupLocationName: dto.pickupLocationName }),
          ...(dto.notes === undefined ? {} : { notes: dto.notes }),
        },
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'staff.courier_account.updated',
          entityType: 'courier_account',
          entityId: accountId,
          changes: { before: this.jsonSafe(existing), after: this.jsonSafe(updated) },
          severity: 'MEDIUM',
        },
        tx,
      );

      return this.toView(updated, existing.courier.code);
    });
  }

  async linkSeller(
    sellerId: string,
    dto: LinkSellerCourierAccountDto,
    staffId: string,
  ): Promise<SellerCourierAccountLinkView> {
    return this.prisma.client.$transaction(async (tx) => {
      const account = await tx.courierAccount.findUnique({
        where: { id: dto.courierAccountId },
      });
      if (!account || account.deletedAt !== null) {
        throw new NotFoundException({
          code: 'COURIER_ACCOUNT_NOT_FOUND',
          message: `Courier account ${dto.courierAccountId} not found`,
        });
      }
      const seller = await tx.seller.findUnique({ where: { id: sellerId } });
      if (!seller) {
        throw new NotFoundException({
          code: 'SELLER_NOT_FOUND',
          message: `Seller ${sellerId} not found`,
        });
      }

      const link = await tx.sellerCourierAccountLink.upsert({
        where: { sellerId_courierAccountId: { sellerId, courierAccountId: dto.courierAccountId } },
        create: {
          sellerId,
          courierAccountId: dto.courierAccountId,
          distributionWeight: dto.distributionWeight ?? 100,
          createdByStaffId: staffId,
        },
        update: {
          distributionWeight: dto.distributionWeight ?? 100,
          isActive: true,
        },
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'staff.seller_courier_account_link.set',
          entityType: 'seller_courier_account_link',
          entityId: link.id,
          metadata: {
            sellerId,
            courierAccountId: dto.courierAccountId,
            distributionWeight: link.distributionWeight,
          },
          severity: 'MEDIUM',
        },
        tx,
      );

      return this.toLinkView(link);
    });
  }

  async listLinks(sellerId: string): Promise<readonly SellerCourierAccountLinkView[]> {
    const rows = await this.prisma.client.sellerCourierAccountLink.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toLinkView(r));
  }

  async updateLink(
    sellerId: string,
    courierAccountId: string,
    dto: UpdateSellerCourierAccountLinkDto,
    staffId: string,
  ): Promise<SellerCourierAccountLinkView> {
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.sellerCourierAccountLink.findUnique({
        where: { sellerId_courierAccountId: { sellerId, courierAccountId } },
      });
      if (!existing) {
        throw new NotFoundException({
          code: 'SELLER_COURIER_ACCOUNT_LINK_NOT_FOUND',
          message: `No link between seller ${sellerId} and courier account ${courierAccountId}`,
        });
      }
      const updated = await tx.sellerCourierAccountLink.update({
        where: { sellerId_courierAccountId: { sellerId, courierAccountId } },
        data: {
          ...(dto.distributionWeight === undefined
            ? {}
            : { distributionWeight: dto.distributionWeight }),
          ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
        },
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'staff.seller_courier_account_link.updated',
          entityType: 'seller_courier_account_link',
          entityId: updated.id,
          changes: { before: this.jsonSafe(existing), after: this.jsonSafe(updated) },
          severity: 'MEDIUM',
        },
        tx,
      );
      return this.toLinkView(updated);
    });
  }

  async unlinkSeller(sellerId: string, courierAccountId: string, staffId: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.sellerCourierAccountLink.findUnique({
        where: { sellerId_courierAccountId: { sellerId, courierAccountId } },
      });
      if (!existing) return;
      await tx.sellerCourierAccountLink.delete({
        where: { sellerId_courierAccountId: { sellerId, courierAccountId } },
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'staff.seller_courier_account_link.removed',
          entityType: 'seller_courier_account_link',
          entityId: existing.id,
          metadata: { sellerId, courierAccountId },
          severity: 'MEDIUM',
        },
        tx,
      );
    });
  }

  // ── internals ──

  /** Unsets isDefault on every OTHER active account for this
   *  (courier, environment) pair — must run BEFORE the target row is
   *  created/updated with isDefault=true, so the partial unique index
   *  (courier_accounts_default_uq) never sees two defaults at once. */
  private async clearOtherDefaults(
    tx: Prisma.TransactionClient,
    courierId: string,
    environment: CredentialEnvironment,
    excludeAccountId: string | null,
  ): Promise<void> {
    await tx.courierAccount.updateMany({
      where: {
        courierId,
        environment,
        isDefault: true,
        deletedAt: null,
        ...(excludeAccountId === null ? {} : { id: { not: excludeAccountId } }),
      },
      data: { isDefault: false },
    });
  }

  private toView(
    row: {
      id: string;
      environment: CredentialEnvironment;
      label: string;
      isDefault: boolean;
      isActive: boolean;
      pickupLocationName: string | null;
      notes: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    courierCode: string,
  ): CourierAccountView {
    return {
      id: row.id,
      courierCode,
      environment: row.environment,
      label: row.label,
      isDefault: row.isDefault,
      pickupLocationName: row.pickupLocationName,
      isActive: row.isActive,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toLinkView(row: {
    id: string;
    sellerId: string;
    courierAccountId: string;
    distributionWeight: number;
    isActive: boolean;
    createdAt: Date;
  }): SellerCourierAccountLinkView {
    return {
      id: row.id,
      sellerId: row.sellerId,
      courierAccountId: row.courierAccountId,
      distributionWeight: row.distributionWeight,
      isActive: row.isActive,
      createdAt: row.createdAt,
    };
  }

  private jsonSafe(value: unknown): Prisma.InputJsonValue | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
