import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Fields UAT can take off a form — the ONE place that answers.
 *
 * ── WHY THIS IS SERVER-SIDE ──────────────────────────────────────────
 * It started as a constant in `@skydrop/ui` because only the forms
 * needed it. Then the owner asked that unhiding a field bring its CSV
 * column back too, and the CSV importer is here, in the API, which
 * cannot import a frontend package. Duplicating the constant on both
 * sides would give two switches that drift apart silently — the exact
 * failure a feature flag exists to prevent. So the answer lives in
 * `system_settings`, the API reads it directly, and the consoles fetch
 * it. One source, three readers.
 *
 * ── IT FAILS CLOSED, AND THAT MEANS HIDDEN ───────────────────────────
 * A missing row, an unreadable value, a database that will not answer:
 * all of them mean the field stays hidden. The fields are off BECAUSE
 * the client asked for them to be off, so "we could not tell" has to
 * resolve to what the client asked for, not to a field reappearing on a
 * form mid-demo.
 *
 * ── WHY A CACHE, AND WHY A SHORT ONE ─────────────────────────────────
 * Every order form asks on mount and every CSV row would ask again. Two
 * seconds is long enough that an upload of four hundred rows makes one
 * query, and short enough that flipping a switch in the admin screen
 * feels immediate — which matters, because the whole point is that the
 * owner turns these on and off while somebody is watching.
 */

export const UAT_FIELDS = {
  orderDeliveryFee: 'uat.order_delivery_fee_field',
  orderDiscount: 'uat.order_discount_field',
  orderDeclaredValue: 'uat.order_declared_value_field',
} as const;

export type UatField = keyof typeof UAT_FIELDS;

/** Every field, hidden. The answer when nothing can be read. */
const ALL_HIDDEN: Readonly<Record<UatField, boolean>> = {
  orderDeliveryFee: false,
  orderDiscount: false,
  orderDeclaredValue: false,
};

const CACHE_MS = 2_000;

@Injectable()
export class UatFieldsService {
  private readonly logger = new Logger(UatFieldsService.name);
  private cache: { at: number; value: Readonly<Record<UatField, boolean>> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Every field's state, for the consoles. */
  async all(): Promise<Readonly<Record<UatField, boolean>>> {
    const now = Date.now();
    if (this.cache !== null && now - this.cache.at < CACHE_MS) return this.cache.value;

    try {
      const rows = await this.prisma.client.systemSetting.findMany({
        where: { key: { in: Object.values(UAT_FIELDS) } },
        select: { key: true, valueBoolean: true },
      });
      const byKey = new Map(rows.map((r) => [r.key, r.valueBoolean]));
      const value: Record<UatField, boolean> = { ...ALL_HIDDEN };
      for (const [field, key] of Object.entries(UAT_FIELDS) as [UatField, string][]) {
        // `=== true` on purpose: a null column and a missing row both
        // mean hidden, and neither should read as "shown".
        value[field] = byKey.get(key) === true;
      }
      this.cache = { at: now, value };
      return value;
    } catch (e) {
      this.logger.warn(
        { err: e instanceof Error ? e.message : String(e) },
        'UAT field settings unreadable — every field stays hidden',
      );
      return ALL_HIDDEN;
    }
  }

  /** One field. The CSV importer's question, asked per column. */
  async isShown(field: UatField): Promise<boolean> {
    return (await this.all())[field];
  }
}
