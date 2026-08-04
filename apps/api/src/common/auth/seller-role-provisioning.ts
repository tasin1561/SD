import type { Prisma } from '@skydrop/db';
import { DEFAULT_SELLER_ROLES } from './seller-permissions';

/**
 * Give a brand-new company its six starting roles.
 *
 * MUST run inside the same transaction that creates the seller, and
 * BEFORE its owner row — `seller_users.role_id` is NOT NULL, so a
 * company without roles is a company whose first login cannot be
 * created. The migration did this for every seller that already
 * existed; this is the same thing for every one that arrives after.
 *
 * The six are a STARTING POINT, not the vocabulary: an owner can edit
 * five of them and add as many more as the company needs. Only `owner`
 * is fixed, and it carries no permission rows at all — `isOwner` grants
 * everything implicitly, so a permission added in a later release
 * reaches it without a backfill anyone has to remember to write.
 */
export async function provisionDefaultSellerRoles(
  tx: Prisma.TransactionClient,
  sellerId: string,
): Promise<{ readonly ownerRoleId: string; readonly byKey: ReadonlyMap<string, string> }> {
  const byKey = new Map<string, string>();
  let ownerRoleId: string | null = null;

  for (const def of DEFAULT_SELLER_ROLES) {
    const role = await tx.sellerRoleDefinition.create({
      data: {
        sellerId,
        key: def.key,
        name: def.name,
        description: def.description,
        isSystem: true,
        isOwner: def.isOwner ?? false,
        permissions: { create: def.permissions.map((permission) => ({ permission })) },
      },
      select: { id: true },
    });
    byKey.set(def.key, role.id);
    if (def.isOwner === true) ownerRoleId = role.id;
  }

  // Unreachable while DEFAULT_SELLER_ROLES contains an owner entry, and
  // a loud failure is the right response if somebody removes it: a
  // company with no owner role has no way back into its own account.
  if (ownerRoleId === null) {
    throw new Error('DEFAULT_SELLER_ROLES defines no owner role');
  }
  return { ownerRoleId, byKey };
}

/** The role a legacy `SellerUserRole` enum value maps to, within one seller. */
export async function sellerRoleIdForEnum(
  tx: Prisma.TransactionClient,
  sellerId: string,
  role: string,
): Promise<string> {
  const found = await tx.sellerRoleDefinition.findFirst({
    where: { sellerId, key: role.toLowerCase(), deletedAt: null },
    select: { id: true },
  });
  if (found === null) {
    throw new Error(`Seller ${sellerId} has no '${role.toLowerCase()}' role`);
  }
  return found.id;
}
