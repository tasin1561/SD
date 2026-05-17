import { Injectable, Logger } from '@nestjs/common';
import { NotificationRecipientType } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../config/env.service';
import { CatalogReadService } from '../catalog-read/services/catalog-read.service';
import { EmailQueue } from '../email/queue/email.queue';
import { StockAvailabilityService } from './stock-availability.service';

const ALERT_TEMPLATE = 'seller.stock_low_alert.email';
const COOLDOWN_SETTING_KEY = 'ops.stock_alert_cooldown_hours';
const DEFAULT_COOLDOWN_HOURS = 24;

export type AlertOutcome =
  | 'FIRED'
  | 'SUPPRESSED_COOLDOWN'
  | 'ALREADY_ACTIVE'
  | 'CLEARED'
  | 'NOOP'
  | 'SKIPPED_NO_THRESHOLD'
  | 'SKIPPED_UNKNOWN_VARIANT';

export interface AlertEvaluation {
  outcome: AlertOutcome;
  wasAlertActive: boolean;
  qtyAvailable: number | null;
  threshold: number | null;
}

/**
 * Low-stock alert state machine (INV-9), evaluated per
 * (seller, variant, warehouse) against the LIVE availability (INV-2/INV-3 —
 * never the display cache). State lives in stock_alert_state (its own
 * table — see commit-1 rationale), one row per grain.
 *
 * INV-5: evaluate() runs AFTER the stock mutation transaction has
 * committed, NEVER inside it. Callers (receipt / adjustment / reservation
 * release flows in later commits) invoke it post-commit.
 *
 * Transitions (avail vs effective threshold = variant override -> seller
 * default; null => alerting unconfigured, skip):
 *   inactive + below  -> FIRE (unless within cooldown of last send ->
 *                         go active but SUPPRESS the email)
 *   active   + below  -> ALREADY_ACTIVE (no re-fire)
 *   active   + ok     -> CLEAR (keep lowStockAlertSentAt for cooldown math)
 *   inactive + ok     -> NOOP
 */
@Injectable()
export class StockAlertService {
  private readonly logger = new Logger(StockAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly availability: StockAvailabilityService,
    private readonly catalog: CatalogReadService,
    private readonly email: EmailQueue,
  ) {}

  async evaluate(
    sellerId: string,
    variantId: string,
    warehouseId: string,
    now: Date = new Date(),
  ): Promise<AlertEvaluation> {
    const variant = await this.catalog.getVariantById(variantId);
    if (!variant || variant.sellerId !== sellerId) {
      return {
        outcome: 'SKIPPED_UNKNOWN_VARIANT',
        wasAlertActive: false,
        qtyAvailable: null,
        threshold: null,
      };
    }

    const seller = await this.prisma.client.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, email: true, companyName: true, defaultLowStockThreshold: true },
    });
    if (!seller) {
      return {
        outcome: 'SKIPPED_UNKNOWN_VARIANT',
        wasAlertActive: false,
        qtyAvailable: null,
        threshold: null,
      };
    }

    const threshold = variant.lowStockThreshold ?? seller.defaultLowStockThreshold ?? null;
    // INV-9 against LIVE availability via the shared primitive (never the
    // display cache). compute() clamps to ≥0 — identical alert decisions
    // to the old unclamped live.qtyAvailable for any positive threshold.
    const qtyAvailable = await this.availability.compute({
      sellerId,
      variantId,
      warehouseId,
    });

    if (threshold === null) {
      return { outcome: 'SKIPPED_NO_THRESHOLD', wasAlertActive: false, qtyAvailable, threshold };
    }

    const state = await this.prisma.client.stockAlertState.findUnique({
      where: {
        sellerId_variantId_warehouseId: { sellerId, variantId, warehouseId },
      },
      select: { wasAlertActive: true, lowStockAlertSentAt: true },
    });
    const wasActive = state?.wasAlertActive ?? false;
    const lastSentAt = state?.lowStockAlertSentAt ?? null;
    const belowThreshold = qtyAvailable < threshold;

    // --- decide ---
    let nextActive = wasActive;
    let nextSentAt: Date | null = lastSentAt;
    let outcome: AlertOutcome;
    let enqueue = false;

    if (!wasActive && belowThreshold) {
      nextActive = true;
      const cooldownMs = (await this.cooldownHours()) * 3_600_000;
      const inCooldown =
        lastSentAt !== null && lastSentAt.getTime() + cooldownMs > now.getTime();
      if (inCooldown) {
        outcome = 'SUPPRESSED_COOLDOWN';
      } else {
        nextSentAt = now;
        enqueue = true;
        outcome = 'FIRED';
      }
    } else if (wasActive && belowThreshold) {
      outcome = 'ALREADY_ACTIVE';
    } else if (wasActive && !belowThreshold) {
      nextActive = false; // keep nextSentAt for future cooldown math
      outcome = 'CLEARED';
    } else {
      outcome = 'NOOP';
    }

    // Nothing changed and nothing to send: no write.
    if (outcome === 'NOOP' && !state) {
      return { outcome, wasAlertActive: false, qtyAvailable, threshold };
    }
    if (nextActive === wasActive && nextSentAt === lastSentAt && !enqueue) {
      return { outcome, wasAlertActive: nextActive, qtyAvailable, threshold };
    }

    // Persist state + (if firing) enqueue the email atomically. This tx is
    // independent of — and strictly after — the stock mutation tx (INV-5).
    await this.prisma.client.$transaction(async (tx) => {
      await tx.stockAlertState.upsert({
        where: {
          sellerId_variantId_warehouseId: { sellerId, variantId, warehouseId },
        },
        create: {
          sellerId,
          variantId,
          warehouseId,
          wasAlertActive: nextActive,
          lowStockAlertSentAt: nextSentAt,
        },
        update: { wasAlertActive: nextActive, lowStockAlertSentAt: nextSentAt },
      });

      if (enqueue) {
        await this.email.enqueue({
          templateCode: ALERT_TEMPLATE,
          recipient: {
            type: NotificationRecipientType.SELLER,
            id: seller.id,
            email: seller.email,
          },
          variables: {
            company_name: seller.companyName,
            sku_code: variant.skuCode,
            variant_label: variant.variantLabel ? ` (${variant.variantLabel})` : '',
            qty_available: qtyAvailable,
            threshold,
            warehouse_name: await this.warehouseName(warehouseId),
            app_url: this.env.sellerAppUrl,
          },
          triggerEvent: 'inventory.stock.low',
        });
      }
    });

    this.logger.log(
      { sellerId, variantId, warehouseId, outcome, qtyAvailable, threshold },
      'Stock alert evaluated',
    );
    return { outcome, wasAlertActive: nextActive, qtyAvailable, threshold };
  }

  // ---------- internal ----------

  private async cooldownHours(): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: COOLDOWN_SETTING_KEY },
      select: { valueInt: true },
    });
    return row?.valueInt ?? DEFAULT_COOLDOWN_HOURS;
  }

  private async warehouseName(warehouseId: string): Promise<string> {
    const wh = await this.prisma.client.warehouse.findUnique({
      where: { id: warehouseId },
      select: { name: true },
    });
    return wh?.name ?? warehouseId;
  }
}
