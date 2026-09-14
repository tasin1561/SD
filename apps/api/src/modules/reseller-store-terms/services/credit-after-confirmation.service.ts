import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  ResellerCreditTrigger,
  ResellerStoreStatus,
  SellerStoreKind,
  SettingValueType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { ResellerTermsNotifier } from './reseller-terms-notifier.service';

/** The SET-1 key (decision 10). Seeded FALSE; the global row is not admin-editable. */
export const CREDIT_AFTER_CONFIRMATION_KEY = 'reseller.credit_after_confirmation_enabled';

export interface FlaggedStore {
  readonly storeId: string;
  readonly storeName: string;
  readonly version: number;
}

export interface CreditAfterConfirmationStatus {
  readonly sellerId: string;
  readonly enabled: boolean;
  /** SELLER_OVERRIDE once Skydrop has decided for this seller; SYSTEM_DEFAULT (off) before. */
  readonly source: 'SELLER_OVERRIDE' | 'SYSTEM_DEFAULT' | 'UNREADABLE';
  /**
   * The seller's live reseller stores whose CURRENT terms credit a party
   * after confirmation while the switch is off. Always empty while it is on.
   */
  readonly flaggedStores: readonly FlaggedStore[];
}

/**
 * RS-4 / decision 10 — whether a seller's reseller-store terms may credit a
 * party N days after CONFIRMATION (money fronted before the customer pays).
 *
 * ── ONE READER, ONE WRITER ───────────────────────────────────────────
 * `isEnabled` is how every other part of RS-4 asks (publish, the order
 * readiness phase 3b calls, the views). `set` is the ONLY writer — it goes
 * through `SettingsResolverService.setOverride` with `dedicated: true`,
 * which the generic override endpoints cannot pass (DEDICATED_OVERRIDE_KEYS).
 *
 * ── SWITCHING IT OFF REWRITES NOTHING ────────────────────────────────
 * A store's terms are an agreement both sides can read; changing one under
 * them would be worse than the risk it removes. So turning it off:
 *   - refuses any NEW version that uses AFTER_CONFIRMATION (publish asks
 *     `isEnabled`);
 *   - FLAGS every store whose current version still uses it — derived on
 *     read, never stored, so it clears itself the moment the seller
 *     publishes a version without it (or Skydrop switches it back on);
 *   - tells the seller in-app which stores, once, at the moment of the
 *     switch;
 *   - and `orderReadiness` reports `AFTER_CONFIRMATION_NOT_ENABLED`, so
 *     phase 3b refuses new orders on a flagged store rather than front
 *     money Skydrop has withdrawn permission for.
 *
 * ── FAILS CLOSED ─────────────────────────────────────────────────────
 * An unreadable setting reads as OFF. This is fronted money: the failure
 * that matters is extending credit nobody granted, not refusing a version
 * for a minute while the database recovers.
 */
@Injectable()
export class CreditAfterConfirmationService {
  private readonly logger = new Logger(CreditAfterConfirmationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsResolverService,
    private readonly notifier: ResellerTermsNotifier,
  ) {}

  async isEnabled(sellerId: string): Promise<boolean> {
    return (await this.read(sellerId)).enabled;
  }

  async status(sellerId: string): Promise<CreditAfterConfirmationStatus> {
    await this.assertSeller(sellerId);
    const read = await this.read(sellerId);
    return {
      sellerId,
      enabled: read.enabled,
      source: read.source,
      flaggedStores: read.enabled ? [] : await this.storesUsingIt(sellerId),
    };
  }

  /**
   * Switch it on or off for one seller. The reason is required (≥ 20
   * characters, validated by the DTO), audited HIGH with the stores that
   * end up flagged.
   */
  async set(
    sellerId: string,
    input: { enabled: boolean; reason: string },
    staffId: string,
  ): Promise<CreditAfterConfirmationStatus> {
    await this.assertSeller(sellerId);
    const before = await this.read(sellerId);
    await this.settings.setOverride(
      sellerId,
      CREDIT_AFTER_CONFIRMATION_KEY,
      { valueType: SettingValueType.BOOLEAN, value: input.enabled, note: input.reason },
      { staffId, dedicated: true },
    );
    const after = await this.status(sellerId);

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      sellerId,
      action: input.enabled
        ? 'staff.reseller_credit_after_confirmation.enabled'
        : 'staff.reseller_credit_after_confirmation.disabled',
      // About a seller-level switch, not a row of its own.
      entityType: 'seller',
      entityId: sellerId,
      severity: 'HIGH',
      changes: { from: before.enabled, to: input.enabled },
      metadata: {
        reason: input.reason,
        flaggedStores: after.flaggedStores.map((s) => ({ storeId: s.storeId, version: s.version })),
      },
    });

    if (!input.enabled && before.enabled && after.flaggedStores.length > 0) {
      await this.notifier.needsRevision({ sellerId, stores: after.flaggedStores });
    }
    return after;
  }

  /** Stores whose CURRENT (latest) version credits either party after confirmation. */
  async storesUsingIt(sellerId: string): Promise<readonly FlaggedStore[]> {
    const stores = await this.prisma.client.sellerStore.findMany({
      where: {
        sellerId,
        kind: SellerStoreKind.RESELLER,
        deletedAt: null,
        status: { notIn: [ResellerStoreStatus.CLOSED, ResellerStoreStatus.REJECTED] },
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        termsVersions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { version: true, storeCreditTrigger: true, sellerCreditTrigger: true },
        },
      },
    });
    const out: FlaggedStore[] = [];
    for (const s of stores) {
      const v = s.termsVersions[0];
      if (v === undefined) continue;
      if (
        v.storeCreditTrigger === ResellerCreditTrigger.AFTER_CONFIRMATION ||
        v.sellerCreditTrigger === ResellerCreditTrigger.AFTER_CONFIRMATION
      ) {
        out.push({ storeId: s.id, storeName: s.displayName ?? s.name, version: v.version });
      }
    }
    return out;
  }

  private async read(
    sellerId: string,
  ): Promise<{ enabled: boolean; source: CreditAfterConfirmationStatus['source'] }> {
    try {
      const r = await this.settings.resolve(sellerId, CREDIT_AFTER_CONFIRMATION_KEY);
      return { enabled: r.value === true, source: r.source };
    } catch (err) {
      this.logger.warn(
        { sellerId, err: err instanceof Error ? err.message : String(err) },
        'Credit-after-confirmation setting unreadable; treating it as OFF (fails closed)',
      );
      return { enabled: false, source: 'UNREADABLE' };
    }
  }

  private async assertSeller(sellerId: string): Promise<void> {
    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: { id: true },
    });
    if (seller === null) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'No such seller' });
    }
  }
}
