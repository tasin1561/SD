import { Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, Prisma, ResellerStoreActionMode, SellerStoreKind } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

/**
 * What a reseller store may do about an order on its own (2026-09-16).
 *
 * The owner's rule: give the store the access, and let the SELLER choose
 * which parts go straight through and which come to them first. This
 * service owns that choice — one row per store, set by the seller.
 *
 * ── A MISSING ROW IS NOT "NOTHING ALLOWED" ───────────────────────────
 * Every store starts with the DEFAULTS below and no row at all. Reading
 * an absent row as OFF would have silently taken `cancel` away from every
 * store the day this shipped — they hold `orders.cancel` today. So the
 * defaults live in ONE place (`DEFAULT_POLICY`), the column defaults in
 * the migration say the same thing, and `policySpec` pins that the two
 * agree: a default that drifts between the table and the code is a store
 * being told it may do something the database refuses, or the reverse.
 *
 * ── WHAT DIRECT DOES, PER CAPABILITY (corrected 2026-09-17) ─────────
 * DIRECT means the store's click is treated exactly as the seller's own
 * ask would be — and what that DOES differs:
 *   recall          — our call centre is queued to ring the customer, now.
 *   reattempt       — a ticket opens and the store's words go to the
 *                     courier outbox; Skydrop staff send it by hand.
 *   sendBack        — the courier is asked to cancel on the store's click,
 *                     and the parcel turns round. No person in between.
 *   cancel          — the order is called off, now.
 *   orderChange      — the correction is written onto the order, now.
 *   callCapDecision — the answer is applied to the review, now.
 *   chaseSkydrop    — the issue ticket opens with Skydrop, now.
 * ASK_SELLER holds every one of the seven for seller staff to approve or
 * reject; approving runs the same path as DIRECT. This comment used to
 * say a send-back "still lands in the Skydrop operator queue" — it never
 * did; CUR-10's seller amendment lets that cancel through directly.
 */

/** The capabilities a policy covers. A new one is a COLUMN and a decision. */
export const ACTION_CAPABILITIES = [
  'recall',
  'orderChange',
  'cancel',
  'callCapDecision',
  'chaseSkydrop',
  'reattempt',
  'sendBack',
] as const;

export type ActionCapability = (typeof ACTION_CAPABILITIES)[number];

/**
 * The COLUMN each capability lives in. Only `orderChange` differs from
 * its own name, and deliberately: it was `addressFix` until 2026-09-18,
 * when the owner widened it from "correct the address" to "change the
 * order". Keeping the column means no data migration and no store
 * silently losing the setting its seller chose; the map is what stops
 * anything deriving the column name from the field name and getting it
 * wrong. `reseller-store-action-policy.spec.ts` reads the migration
 * through this map.
 */
export const CAPABILITY_COLUMN: Readonly<Record<ActionCapability, string>> = {
  recall: 'recall',
  orderChange: 'address_fix',
  cancel: 'cancel',
  callCapDecision: 'call_cap_decision',
  chaseSkydrop: 'chase_skydrop',
  reattempt: 'reattempt',
  sendBack: 'send_back',
};

/**
 * What a store may do before anybody decides anything.
 *
 * DIRECT for everything that spends nobody's money — the instruction was
 * to give the store the access. `cancel` is DIRECT because stores already
 * have it and this must not take it away. The two that reach Delhivery
 * start at ASK_SELLER: a re-attempt sends a van, a send-back turns a
 * moving parcel round, and the return fee is split by the terms.
 *
 * MUST match the column defaults in
 * `20260916000000_reseller_store_action_policy`.
 */
export const DEFAULT_POLICY: Readonly<Record<ActionCapability, ResellerStoreActionMode>> = {
  recall: ResellerStoreActionMode.DIRECT,
  // WIDENED 2026-09-18 (owner): "change the order", not only its
  // address. Same column, same default — a store that could correct an
  // address directly can now change the order directly, which is exactly
  // what the owner asked for.
  orderChange: ResellerStoreActionMode.DIRECT,
  cancel: ResellerStoreActionMode.DIRECT,
  callCapDecision: ResellerStoreActionMode.DIRECT,
  chaseSkydrop: ResellerStoreActionMode.DIRECT,
  reattempt: ResellerStoreActionMode.ASK_SELLER,
  sendBack: ResellerStoreActionMode.ASK_SELLER,
};

export type ActionPolicyInput = Readonly<Record<ActionCapability, ResellerStoreActionMode>>;

export interface ActionPolicyView extends ActionPolicyInput {
  readonly storeId: string;
  /** False when no row exists yet — the store is running on the defaults. */
  readonly set: boolean;
  readonly updatedAt: string | null;
}

type PolicyRow = {
  [K in ActionCapability]: ResellerStoreActionMode;
} & { storeId: string; updatedAt: Date };

/** The effective policy: the row if there is one, else the defaults. */
export function effectivePolicy(storeId: string, row: PolicyRow | null): ActionPolicyView {
  const modes = {} as Record<ActionCapability, ResellerStoreActionMode>;
  for (const key of ACTION_CAPABILITIES) {
    modes[key] = row === null ? DEFAULT_POLICY[key] : row[key];
  }
  return {
    storeId,
    ...modes,
    set: row !== null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

/** What one capability is set to — the question every action site asks. */
export function modeFor(
  policy: ActionPolicyView,
  capability: ActionCapability,
): ResellerStoreActionMode {
  return policy[capability];
}

@Injectable()
export class ResellerStoreActionPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** The seller reading one of THEIR stores' policy. */
  async getForSeller(sellerId: string, storeId: string): Promise<ActionPolicyView> {
    await this.ownStore(sellerId, storeId);
    const row = await this.prisma.client.resellerStoreActionPolicy.findUnique({
      where: { storeId },
    });
    return effectivePolicy(storeId, row as PolicyRow | null);
  }

  /**
   * The policy for a store, by store id alone — for the action sites,
   * which already know the caller's store from their token.
   */
  async forStore(storeId: string): Promise<ActionPolicyView> {
    const row = await this.prisma.client.resellerStoreActionPolicy.findUnique({
      where: { storeId },
    });
    return effectivePolicy(storeId, row as PolicyRow | null);
  }

  /** The seller setting the whole policy at once. */
  async setPolicy(
    seller: AuthenticatedSeller,
    storeId: string,
    input: ActionPolicyInput,
  ): Promise<ActionPolicyView> {
    const store = await this.ownStore(seller.id, storeId);
    const before = (await this.prisma.client.resellerStoreActionPolicy.findUnique({
      where: { storeId },
    })) as PolicyRow | null;

    const data = {} as Record<ActionCapability, ResellerStoreActionMode>;
    for (const key of ACTION_CAPABILITIES) data[key] = input[key];

    const saved = (await this.prisma.client.resellerStoreActionPolicy.upsert({
      where: { storeId },
      create: { storeId, ...data, updatedBySellerUserId: seller.userId },
      update: { ...data, updatedBySellerUserId: seller.userId },
    })) as PolicyRow;

    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: seller.userId,
      sellerId: seller.id,
      action: 'reseller_store.action_policy_set',
      entityType: 'seller_store',
      entityId: storeId,
      severity: 'MEDIUM',
      changes: {
        // The effective policy either side, so a reader sees what actually
        // changed rather than "null → everything" on the first save.
        before: effectivePolicy(storeId, before),
        after: effectivePolicy(storeId, saved),
      } as unknown as Prisma.InputJsonValue,
      metadata: { name: store.name },
    });

    return effectivePolicy(storeId, saved);
  }

  /** This seller's own RESELLER store, or a 404 that says nothing more. */
  private async ownStore(sellerId: string, storeId: string): Promise<{ id: string; name: string }> {
    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, sellerId, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: { id: true, name: true },
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    return store;
  }
}
