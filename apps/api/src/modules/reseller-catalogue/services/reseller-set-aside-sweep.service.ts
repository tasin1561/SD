import { Injectable, Logger } from '@nestjs/common';
import { ActorType, ResellerStockMode } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { StockReadService } from '../../inventory-stock/services/stock-read.service';
import { COMMITTING_STORE_STATUSES } from './reseller-catalogue.service';
import { ResellerSetAsideNotifier } from './reseller-set-aside-notifier.service';
import { planShrink } from './reseller-visible-stock';

export interface ShrinkRecord {
  readonly shrinkId: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly fromQty: number;
  readonly toQty: number;
}

export interface SweepResult {
  readonly pairsChecked: number;
  readonly pairsOverCommitted: number;
  readonly shrunk: number;
  readonly failures: number;
}

/**
 * RS-3 — keeps Σ reseller set-asides inside what exists.
 *
 * The save-time guard (`SET_ASIDE_EXCEEDS_STOCK`) holds the rule at the
 * moment a seller promises stock; stock then moves without asking — a
 * parcel packs, a count comes up short, a unit is written off. This
 * sweep (hourly) finds every (seller, variant) whose live stores' set-
 * asides add up to more than the variant's pickable on-hand and cuts
 * them NEWEST-FIRST (`planShrink`) until they fit.
 *
 * It NEVER touches stock (INV-1: it writes only `reseller_store_variants`
 * and its own `reseller_set_aside_shrinks` history), and it cuts under
 * the same `AdvisoryLock.RESELLER_SET_ASIDE` key a seller's save takes,
 * re-reading the rows and the on-hand INSIDE the lock, so it can never
 * cut a figure a seller has just changed. Each cut is a guarded
 * `updateMany` on the quantity it read, and its history row is written
 * in the same transaction (the durable fact); the audit row and the
 * seller's notice come after the commit (the reflection).
 *
 * Per-pair isolation: one pair's failure is counted and logged, and the
 * rest of the sweep carries on.
 */
@Injectable()
export class ResellerSetAsideSweepService {
  private readonly logger = new Logger(ResellerSetAsideSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockReadService,
    private readonly catalog: CatalogReadService,
    private readonly notifier: ResellerSetAsideNotifier,
    private readonly audit: AuditLogService,
  ) {}

  async sweep(): Promise<SweepResult> {
    const groups = await this.prisma.client.resellerStoreVariant.groupBy({
      by: ['sellerId', 'variantId'],
      where: {
        stockMode: ResellerStockMode.SET_ASIDE,
        setAsideQty: { gt: 0 },
        store: { status: { in: [...COMMITTING_STORE_STATUSES] }, deletedAt: null },
      },
      _sum: { setAsideQty: true },
    });
    const bySeller = new Map<string, Array<{ variantId: string; total: number }>>();
    for (const g of groups) {
      const list = bySeller.get(g.sellerId) ?? [];
      list.push({ variantId: g.variantId, total: g._sum.setAsideQty ?? 0 });
      bySeller.set(g.sellerId, list);
    }

    let over = 0;
    let shrunk = 0;
    let failures = 0;
    for (const [sellerId, pairs] of bySeller) {
      let stock: ReadonlyMap<string, { onHand: number }>;
      try {
        stock = await this.stock.getSellableStockLive(
          sellerId,
          pairs.map((p) => p.variantId),
        );
      } catch (err) {
        failures += pairs.length;
        this.logger.warn(
          { sellerId, err: err instanceof Error ? err.message : String(err) },
          'Could not read stock for a seller; their set-asides are checked next hour',
        );
        continue;
      }
      for (const pair of pairs) {
        if (pair.total <= (stock.get(pair.variantId)?.onHand ?? 0)) continue;
        over += 1;
        try {
          shrunk += (await this.shrinkOne(sellerId, pair.variantId)).length;
        } catch (err) {
          failures += 1;
          this.logger.warn(
            {
              sellerId,
              variantId: pair.variantId,
              err: err instanceof Error ? err.message : String(err),
            },
            'Reseller set-aside shrink failed for one product; carrying on',
          );
        }
      }
    }
    return { pairsChecked: groups.length, pairsOverCommitted: over, shrunk, failures };
  }

  /** Bring one (seller, variant) back inside on-hand. Public: the manual trigger. */
  async shrinkOne(sellerId: string, variantId: string): Promise<readonly ShrinkRecord[]> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      await takeAdvisoryLock(tx, AdvisoryLock.RESELLER_SET_ASIDE, `${sellerId}|${variantId}`);
      const rows = await tx.resellerStoreVariant.findMany({
        where: {
          sellerId,
          variantId,
          stockMode: ResellerStockMode.SET_ASIDE,
          store: { status: { in: [...COMMITTING_STORE_STATUSES] }, deletedAt: null },
        },
        select: {
          id: true,
          storeId: true,
          setAsideQty: true,
          setAsideAt: true,
          store: { select: { name: true } },
        },
      });
      const onHand =
        (await this.stock.getSellableStockLive(sellerId, [variantId])).get(variantId)?.onHand ?? 0;
      const totalBefore = rows.reduce((s, r) => s + (r.setAsideQty ?? 0), 0);
      const plan = planShrink(
        onHand,
        rows.map((r) => ({ id: r.id, setAsideQty: r.setAsideQty ?? 0, setAsideAt: r.setAsideAt })),
      );
      const out: ShrinkRecord[] = [];
      for (const step of plan) {
        const row = rows.find((r) => r.id === step.id);
        if (row === undefined) continue;
        const changed = await tx.resellerStoreVariant.updateMany({
          where: { id: step.id, stockMode: ResellerStockMode.SET_ASIDE, setAsideQty: step.fromQty },
          data: { setAsideQty: step.toQty },
        });
        if (changed.count === 0) continue;
        const event = await tx.resellerSetAsideShrink.create({
          data: {
            storeVariantId: step.id,
            storeId: row.storeId,
            sellerId,
            variantId,
            fromQty: step.fromQty,
            toQty: step.toQty,
            onHand,
            totalBefore,
          },
          select: { id: true },
        });
        out.push({
          shrinkId: event.id,
          storeId: row.storeId,
          storeName: row.store.name,
          fromQty: step.fromQty,
          toQty: step.toQty,
        });
      }
      return { out, onHand, totalBefore };
    });

    if (result.out.length === 0) return result.out;
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      sellerId,
      action: 'reseller.set_aside.shrunk',
      entityType: 'reseller_store_variant',
      entityId: null,
      severity: 'MEDIUM',
      metadata: {
        variantId,
        onHand: result.onHand,
        totalBefore: result.totalBefore,
        shrinks: result.out.map((s) => ({
          shrinkId: s.shrinkId,
          storeId: s.storeId,
          fromQty: s.fromQty,
          toQty: s.toQty,
        })),
      },
    });
    let skuCode = variantId;
    try {
      skuCode = (await this.catalog.getVariantById(variantId))?.skuCode ?? variantId;
    } catch {
      // The notice still goes out, naming the id instead of the SKU.
    }
    await this.notifier.setAsideShrunk({
      sellerId,
      skuCode,
      onHand: result.onHand,
      steps: result.out,
    });
    return result.out;
  }
}
