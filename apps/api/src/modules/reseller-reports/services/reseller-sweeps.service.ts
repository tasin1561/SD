import { Injectable, Logger } from '@nestjs/common';
import {
  ResellerStoreStatus,
  SellerStoreKind,
  SystemIssueKind,
  SystemIssueSeverity,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { AdminResellerAnalysisService } from './admin-reseller-analysis.service';
import type { FraudRule } from './reseller-fraud-rules';
import { ResellerReportsNotifier } from './reseller-reports-notifier.service';
import { SellerResellerAnalysisService } from './seller-reseller-analysis.service';

export const FRAUD_ISSUE_PREFIX = 'reseller-fraud:';

const RULE_TITLES: Record<FraudRule, string> = {
  CANCEL_RATE: 'high cancel rate',
  RETURN_RATE: 'high return rate',
  NDR_RATE: 'high failed-delivery rate',
  RAPID_ORDERS: 'rapid-fire orders',
  RETAIL_MARKUP: 'retail far above suggested',
  SHARED_CUSTOMER: 'customers shared with other stores',
};

export function fraudIssueKey(rule: FraudRule, storeId: string): string {
  return `${FRAUD_ISSUE_PREFIX}${rule.toLowerCase()}:${storeId}`;
}

/** The ISO week an instant falls in, read in India — `2026-W38`. */
export function isoWeekKey(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  const day = (ist.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - day + 3),
  );
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * RS-9's two daily sweeps.
 *
 * FRAUD: every flag the admin list shows (the SAME computation) is raised
 * as a `RESELLER_RISK` system issue keyed on (rule, store) — MEDIUM, or
 * HIGH at twice its threshold — and an open one whose flag has cleared is
 * resolved. Only a crossed threshold is ever raised.
 *
 * STOCK: tells each seller with live reseller stores, in-app and at most
 * once a week, which products they sell will run low.
 */
@Injectable()
export class ResellerSweepsService {
  private readonly logger = new Logger(ResellerSweepsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminResellerAnalysisService,
    private readonly seller: SellerResellerAnalysisService,
    private readonly issues: SystemIssueService,
    private readonly notifier: ResellerReportsNotifier,
  ) {}

  async fraud(now: Date = new Date()): Promise<{ flags: number; cleared: number }> {
    const report = await this.admin.fraud(now);
    const live = new Set<string>();
    for (const f of report.flags) {
      const key = fraudIssueKey(f.rule, f.storeId);
      live.add(key);
      await this.issues.raise({
        kind: SystemIssueKind.RESELLER_RISK,
        severity: f.severity === 'HIGH' ? SystemIssueSeverity.HIGH : SystemIssueSeverity.MEDIUM,
        title: `Reseller store “${f.storeName}”: ${RULE_TITLES[f.rule]}`,
        detail:
          `${f.reason} Seller: ${f.sellerName}. Look at the store on Reseller stores → Analysis; ` +
          'pause it there if it is not explained. This clears itself once the signal is back under its threshold.',
        source: ResellerSweepsService.name,
        dedupeKey: key,
        metadata: {
          rule: f.rule,
          storeId: f.storeId,
          sellerId: f.sellerId,
          value: f.value,
          threshold: f.threshold,
        },
      });
    }
    const open = await this.prisma.client.systemIssue.findMany({
      where: { resolvedAt: null, dedupeKey: { startsWith: FRAUD_ISSUE_PREFIX } },
      select: { dedupeKey: true },
    });
    let cleared = 0;
    for (const o of open) {
      if (live.has(o.dedupeKey)) continue;
      cleared += await this.issues.resolveByKey(
        o.dedupeKey,
        'Back under its threshold — cleared by the daily reseller fraud sweep.',
      );
    }
    return { flags: report.flags.length, cleared };
  }

  async stock(now: Date = new Date()): Promise<{ sellers: number; notified: number }> {
    const sellers = await this.prisma.client.sellerStore.findMany({
      where: {
        kind: SellerStoreKind.RESELLER,
        deletedAt: null,
        status: { in: [ResellerStoreStatus.ACTIVE, ResellerStoreStatus.PAUSED] },
      },
      distinct: ['sellerId'],
      select: { sellerId: true },
    });
    let notified = 0;
    const weekKey = isoWeekKey(now);
    for (const { sellerId } of sellers) {
      try {
        const f = await this.seller.stockForecast(sellerId, now);
        const low = f.rows.filter((r) => r.reorder);
        if (low.length === 0) continue;
        await this.notifier.stockLow({
          sellerId,
          weekKey,
          reorderDays: f.reorderDays,
          items: low.map((r) => ({
            skuCode: r.skuCode,
            daysOfStock: r.daysOfStock ?? '—',
            available: r.available,
          })),
        });
        notified += 1;
      } catch (err) {
        this.logger.warn(
          { sellerId, err: err instanceof Error ? err.message : String(err) },
          'Stock forecast sweep failed for a seller',
        );
      }
    }
    return { sellers: sellers.length, notified };
  }
}
