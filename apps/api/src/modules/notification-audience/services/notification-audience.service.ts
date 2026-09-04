import { Injectable } from '@nestjs/common';
import {
  NotificationRecipientType,
  NotificationSubjectType,
  NotificationSubscriptionMode,
  SellerStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Who should hear about this.
 *
 * One shape for both sides of the house, so a caller says WHO in the
 * same language whether it is a seller's finance team or every staff
 * member who can pack a parcel.
 */
export type AudienceSelector =
  | { readonly kind: 'ALL_SELLERS' }
  | { readonly kind: 'SELLER_ORG'; readonly sellerId: string }
  | { readonly kind: 'SELLER_ROLE'; readonly sellerId: string; readonly roleKey: string }
  | { readonly kind: 'SELLER_USER'; readonly sellerUserId: string }
  | { readonly kind: 'ALL_STAFF' }
  | { readonly kind: 'STAFF_ROLE'; readonly roleKey: string }
  | { readonly kind: 'STAFF_PERMISSION'; readonly permission: string }
  | { readonly kind: 'STAFF_USER'; readonly staffId: string }
  | { readonly kind: 'SUBSCRIBERS'; readonly topic: string };

export interface ResolvedRecipient {
  readonly recipientType: NotificationRecipientType;
  /** The USER's id — a person, not a company. */
  readonly recipientId: string;
  readonly email: string;
  readonly name: string | null;
  /** The seller this person belongs to, for a seller-side recipient. */
  readonly sellerId: string | null;
  readonly subjectType: NotificationSubjectType;
}

/**
 * Turns "who" into actual people.
 *
 * ── WHY THIS RESOLVES TO USERS, NOT COMPANIES ────────────────────────
 * Seller notifications used to go to `order.seller.email` — one address
 * for a whole company. A seller with a finance person, two packers and
 * an owner got everything at one mailbox, and there was no way to send
 * stock alerts to the people who handle stock. Sellers have had teams,
 * roles and per-role permissions in the schema for a long time; the
 * notification layer simply never looked at them.
 *
 * ── PREFER PERMISSION OVER ROLE FOR STAFF ────────────────────────────
 * Roles here are rows an admin can invent. "Everyone who can pack"
 * keeps working the day somebody creates a Night Shift Lead; "everyone
 * with role WAREHOUSE_STAFF" silently misses them and nobody finds out
 * until a parcel sits unpacked. This is the same argument the RBAC
 * layer already made when it moved from role names to permissions —
 * the guarantee survives an admin inventing a role.
 *
 * Deleted, deactivated and unverified people are excluded everywhere:
 * an audience is who can act on it, not who once could.
 */
@Injectable()
export class NotificationAudienceService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(selector: AudienceSelector): Promise<readonly ResolvedRecipient[]> {
    switch (selector.kind) {
      case 'ALL_SELLERS':
        return this.sellerUsers({ seller: { status: SellerStatus.APPROVED, deletedAt: null } });
      case 'SELLER_ORG':
        return this.sellerUsers({ sellerId: selector.sellerId });
      case 'SELLER_ROLE':
        return this.sellerUsers({
          sellerId: selector.sellerId,
          sellerRole: { key: selector.roleKey },
        });
      case 'SELLER_USER':
        return this.sellerUsers({ id: selector.sellerUserId });
      case 'ALL_STAFF':
        return this.staffUsers({});
      case 'STAFF_ROLE':
        return this.staffUsers({ staffRole: { key: selector.roleKey } });
      case 'STAFF_PERMISSION':
        return this.staffUsers({
          staffRole: { permissions: { some: { permission: selector.permission } } },
        });
      case 'STAFF_USER':
        return this.staffUsers({ id: selector.staffId });
      case 'SUBSCRIBERS':
        return this.subscribers(selector.topic);
      default: {
        const never: never = selector;
        throw new Error(`Unhandled audience selector: ${JSON.stringify(never)}`);
      }
    }
  }

  /** Resolve several selectors as one audience, de-duplicated by person. */
  async resolveMany(selectors: readonly AudienceSelector[]): Promise<readonly ResolvedRecipient[]> {
    const seen = new Map<string, ResolvedRecipient>();
    for (const sel of selectors) {
      for (const r of await this.resolve(sel)) {
        // Somebody in two selectors is still one person with one inbox.
        seen.set(`${r.subjectType}:${r.recipientId}`, r);
      }
    }
    return [...seen.values()];
  }

  /** How many people this would reach — asked BEFORE a broadcast. */
  async count(selector: AudienceSelector): Promise<number> {
    return (await this.resolve(selector)).length;
  }

  private async sellerUsers(where: Record<string, unknown>): Promise<ResolvedRecipient[]> {
    const rows = await this.prisma.client.sellerUser.findMany({
      where: { ...where, deletedAt: null },
      select: { id: true, email: true, fullName: true, sellerId: true },
    });
    return rows.map((r) => ({
      recipientType: NotificationRecipientType.SELLER,
      recipientId: r.id,
      email: r.email,
      name: r.fullName,
      sellerId: r.sellerId,
      subjectType: NotificationSubjectType.SELLER_USER,
    }));
  }

  private async staffUsers(where: Record<string, unknown>): Promise<ResolvedRecipient[]> {
    const rows = await this.prisma.client.staffUser.findMany({
      where: { ...where, deletedAt: null },
      select: { id: true, email: true, emailDisplay: true },
    });
    return rows.map((r) => ({
      recipientType: NotificationRecipientType.STAFF,
      recipientId: r.id,
      email: r.email,
      name: r.emailDisplay,
      sellerId: null,
      subjectType: NotificationSubjectType.STAFF_USER,
    }));
  }

  /**
   * People who asked for this topic even though nothing else would
   * have included them. The opt-IN half of subscriptions; muting is
   * applied later, per channel, at dispatch.
   */
  private async subscribers(topic: string): Promise<ResolvedRecipient[]> {
    const subs = await this.prisma.client.notificationSubscription.findMany({
      where: { topic, mode: NotificationSubscriptionMode.SUBSCRIBED },
      select: { subjectType: true, subjectId: true },
    });
    if (subs.length === 0) return [];

    const sellerIds = subs
      .filter((s) => s.subjectType === NotificationSubjectType.SELLER_USER)
      .map((s) => s.subjectId);
    const staffIds = subs
      .filter((s) => s.subjectType === NotificationSubjectType.STAFF_USER)
      .map((s) => s.subjectId);

    const out: ResolvedRecipient[] = [];
    if (sellerIds.length > 0) out.push(...(await this.sellerUsers({ id: { in: sellerIds } })));
    if (staffIds.length > 0) out.push(...(await this.staffUsers({ id: { in: staffIds } })));
    return out;
  }
}
