import { Injectable, Logger } from '@nestjs/common';
import { AttributeValueType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { CategoryService } from '../../catalog-category/services/category.service';

const CACHE_PREFIX = 'catalog:attrs:effective:';
const CACHE_TTL_SECONDS = 5 * 60;

export interface EffectiveAttribute {
  attributeKey: string;
  displayLabel: string;
  valueType: AttributeValueType;
  allowedValues: string[];
  isRequired: boolean;
  displayOrder: number;
  /** Which category in the ancestor chain supplied the effective value
   *  (the deepest one — child overrides parent). */
  sourceCategoryId: string;
}

/**
 * Resolves the EFFECTIVE attribute set for a category: its own
 * definitions plus every ancestor's, with the closer (deeper) category
 * overriding an ancestor on the same attributeKey.
 *
 * Resolved sets are cached in Redis for 5 minutes. Any write to a
 * category's attribute definitions invalidates that category AND all of
 * its descendants — a parent change ripples into every descendant's
 * effective set. Invalidation-on-write is best-effort (a failed DEL just
 * means the entry serves stale until TTL); see phase-1a-debt for the
 * event-bus-based hardening.
 */
@Injectable()
export class AttributeResolutionService {
  private readonly logger = new Logger(AttributeResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly categories: CategoryService,
  ) {}

  async resolveEffectiveAttributes(categoryId: string): Promise<EffectiveAttribute[]> {
    const cacheKey = `${CACHE_PREFIX}${categoryId}`;

    const cached = await this.safeCacheGet(cacheKey);
    if (cached) return cached;

    // Throws CATEGORY_NOT_FOUND if the category is missing/deleted.
    const chain = await this.categories.getAncestorChainIds(categoryId);

    const defs = await this.prisma.client.categoryAttributeDefinition.findMany({
      where: { categoryId: { in: chain }, deletedAt: null },
      select: {
        categoryId: true,
        attributeKey: true,
        displayLabel: true,
        valueType: true,
        allowedValues: true,
        isRequired: true,
        displayOrder: true,
      },
    });

    const byCategory = new Map<string, typeof defs>();
    for (const d of defs) {
      const bucket = byCategory.get(d.categoryId);
      if (bucket) bucket.push(d);
      else byCategory.set(d.categoryId, [d]);
    }

    // Walk root → leaf so the deepest definition wins per attributeKey.
    const resolved = new Map<string, EffectiveAttribute>();
    for (const catId of chain) {
      for (const d of byCategory.get(catId) ?? []) {
        resolved.set(d.attributeKey, {
          attributeKey: d.attributeKey,
          displayLabel: d.displayLabel,
          valueType: d.valueType,
          allowedValues: d.allowedValues,
          isRequired: d.isRequired,
          displayOrder: d.displayOrder,
          sourceCategoryId: d.categoryId,
        });
      }
    }

    const result = [...resolved.values()].sort(
      (a, b) =>
        a.displayOrder - b.displayOrder ||
        a.attributeKey.localeCompare(b.attributeKey),
    );

    await this.safeCacheSet(cacheKey, result);
    return result;
  }

  /**
   * Invalidate the cached effective set for `categoryId` and every
   * descendant. Called by attribute-definition writes.
   */
  async invalidate(categoryId: string): Promise<void> {
    let ids: string[] = [categoryId];
    try {
      const descendants = await this.categories.getDescendantIds(categoryId);
      ids = [categoryId, ...descendants];
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), categoryId },
        'Failed to enumerate descendants for cache invalidation; clearing self only',
      );
    }
    const keys = ids.map((id) => `${CACHE_PREFIX}${id}`);
    try {
      if (keys.length > 0) await this.redis.client.del(...keys);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Attribute cache invalidation DEL failed; entries will serve stale until TTL',
      );
    }
  }

  // ---------- internal ----------

  private async safeCacheGet(key: string): Promise<EffectiveAttribute[] | null> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as EffectiveAttribute[];
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), key },
        'Attribute cache read failed; resolving from DB',
      );
      return null;
    }
  }

  private async safeCacheSet(key: string, value: EffectiveAttribute[]): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), key },
        'Attribute cache write failed; continuing without cache',
      );
    }
  }
}
