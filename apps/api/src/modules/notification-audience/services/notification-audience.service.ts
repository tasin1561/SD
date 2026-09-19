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
  /**
   * Everyone at ONE company who holds a permission.
   *
   * The seller-side twin of STAFF_PERMISSION, and preferred over
   * SELLER_ROLE for the same reason: a company can invent, rename and
   * delete its own roles, so a notification addressed to "finance" goes
   * quiet the day somebody reorganises. What a person is allowed to DO
   * is the durable fact about whether a message concerns them.
   *
   * An owner holds every permission implicitly (`isOwner`), so they are
   * included without a permission row — the same rule the guard applies.
   */
  | { readonly kind: 'SELLER_PERMISSION'; readonly sellerId: string; readonly permission: string }
  | { readonly kind: 'SELLER_USER'; readonly sellerUserId: string }
  | { readonly kind: 'ALL_STAFF' }
  | { readonly kind: 'STAFF_ROLE'; readonly roleKey: string }
  | { readonly kind: 'STAFF_PERMISSION'; readonly permission: string }
  | { readonly kind: 'STAFF_USER'; readonly staffId: string }
  /**
   * Everyone with a login at ONE reseller store (RS-2, 2026-09-19).
   *
   * The third identity's three selectors mirror the seller's, and for
   * the same reasons. `STORE_PERMISSION` is the one to reach for:
   * a store's roles are rows its seller's team can shape, so an audience
   * named after a role goes quiet the day somebody reorganises, while
   * "whoever can act on orders here" stays true. The owner role holds
   * every permission implicitly, exactly as the seller's and staff's do.
   *
   * Every one of these is SCOPED TO ONE STORE by construction — there is
   * deliberately no `ALL_STORES`. A message to every reseller store on
   * the estate would cross seller boundaries, and nothing needs it.
   */
  | { readonly kind: 'STORE_ORG'; readonly storeId: string }
  | { readonly kind: 'STORE_PERMISSION'; readonly storeId: string; readonly permission: string }
  | { readonly kind: 'STORE_USER'; readonly storeUserId: string }
  | { readonly kind: 'SUBSCRIBERS'; readonly topic: string };

export interface ResolvedRecipient {
  readonly recipientType: NotificationRecipientType;
  /** The USER's id — a person, not a company. */
  readonly recipientId: string;
  readonly email: string;
  readonly name: string | null;
  /** The seller this person belongs to, for a seller-side recipient. */
  readonly sellerId: string | null;
  /**
   * The reseller store this person belongs to, for a store-side
   * recipient — stamped onto the notification_logs row so the store
   * inbox can scope on it (2026-09-19).
   */
  readonly storeId: string | null;
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
      case 'SELLER_PERMISSION':
        return this.sellerUsers({
          sellerId: selector.sellerId,
          sellerRole: {
            OR: [{ isOwner: true }, { permissions: { some: { permission: selector.permission } } }],
          },
        });
      case 'SELLER_USER':
        return this.sellerUsers({ id: selector.sellerUserId });
      case 'ALL_STAFF':
        return this.staffUsers({});
      case 'STAFF_ROLE':
        return this.staffUsers({ staffRole: { key: selector.roleKey } });
      case 'STAFF_PERMISSION':
        return this.staffUsers({
          staffRole: {
            // A super-admin holds every permission implicitly,
            // including ones a later migration adds, so they carry no
            // permission ROWS — matching on rows alone would leave the
            // people who hold the most out of every audience addressed
            // by what somebody is allowed to do. The seller side has
            // the same shape via `isOwner`.
            OR: [
              { isSuperAdmin: true },
              { permissions: { some: { permission: selector.permission } } },
            ],
          },
        });
      case 'STAFF_USER':
        return this.staffUsers({ id: selector.staffId });
      case 'STORE_ORG':
        return this.storeUsers({ storeId: selector.storeId });
      case 'STORE_PERMISSION':
        return this.storeUsers({
          storeId: selector.storeId,
          role: {
            deletedAt: null,
            OR: [{ isOwner: true }, { permissions: { some: { permission: selector.permission } } }],
          },
        });
      case 'STORE_USER':
        return this.storeUsers({ id: selector.storeUserId });
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
      storeId: null,
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
      storeId: null,
      subjectType: NotificationSubjectType.STAFF_USER,
    }));
  }

  /**
   * People with a login at a reseller store (RS-2).
   *
   * `emailDisplay` is what is written to, matching every existing store
   * notifier: `email` is the lowercased lookup form, and sending to a
   * normalised address rather than the one somebody typed is a small
   * disrespect that occasionally bounces.
   *
   * A deleted person, and a person whose ROLE has been deleted, are both
   * excluded — the role is how the guard decides what they may do, and a
   * login the guard refuses is not an audience.
   */
  private async storeUsers(where: Record<string, unknown>): Promise<ResolvedRecipient[]> {
    const rows = await this.prisma.client.storeUser.findMany({
      // The defaults come FIRST and the selector's own clauses override
      // them: `STORE_PERMISSION` supplies its own `role` filter (carrying
      // the same `deletedAt: null`), and spreading it after a default
      // `role` is what keeps the permission from being silently dropped.
      where: { deletedAt: null, role: { deletedAt: null }, ...where },
      select: { id: true, emailDisplay: true, fullName: true, storeId: true },
    });
    return rows.map((r) => ({
      recipientType: NotificationRecipientType.STORE_USER,
      recipientId: r.id,
      email: r.emailDisplay,
      name: r.fullName,
      // The store's SELLER is deliberately not carried: our bank book and
      // our notification ledger both know a store user as a person at a
      // store, and putting the seller here would invite a reader to treat
      // a store message as one of the seller's own (TRE-8c draws the same
      // line for money).
      sellerId: null,
      storeId: r.storeId,
      subjectType: NotificationSubjectType.STORE_USER,
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
    const storeIds = subs
      .filter((s) => s.subjectType === NotificationSubjectType.STORE_USER)
      .map((s) => s.subjectId);

    const out: ResolvedRecipient[] = [];
    if (sellerIds.length > 0) out.push(...(await this.sellerUsers({ id: { in: sellerIds } })));
    if (staffIds.length > 0) out.push(...(await this.staffUsers({ id: { in: staffIds } })));
    if (storeIds.length > 0) out.push(...(await this.storeUsers({ id: { in: storeIds } })));
    return out;
  }
}
