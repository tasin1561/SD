import type { Prisma } from '@skydrop/db';
import { DEFAULT_STORE_ROLES, type StoreRoleKey } from './store-permissions';

/**
 * Create a reseller store's five starting roles, in the caller's tx.
 *
 * Runs in the SAME transaction that creates the store: `store_users.role_id`
 * is NOT NULL, so a store without roles is a store whose first invitation
 * could never be accepted. Idempotent on (store, key) — a retried
 * transaction finds the rows it already made.
 */
export async function provisionDefaultStoreRoles(
  tx: Prisma.TransactionClient,
  storeId: string,
): Promise<Record<StoreRoleKey, string>> {
  const ids = {} as Record<StoreRoleKey, string>;
  for (const def of DEFAULT_STORE_ROLES) {
    const role = await tx.storeRoleDefinition.upsert({
      where: { storeId_key: { storeId, key: def.key } },
      create: {
        storeId,
        key: def.key,
        name: def.name,
        description: def.description,
        isSystem: true,
        isOwner: def.isOwner === true,
      },
      update: {},
      select: { id: true },
    });
    ids[def.key] = role.id;
    if (def.permissions.length > 0) {
      await tx.storeRolePermission.createMany({
        data: def.permissions.map((permission) => ({ roleId: role.id, permission })),
        skipDuplicates: true,
      });
    }
  }
  return ids;
}
