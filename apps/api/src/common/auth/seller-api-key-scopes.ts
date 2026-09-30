import { ALL_SELLER_PERMISSION_KEYS, type SellerPermissionKey } from './seller-permissions';

/**
 * What a seller's API key is allowed to reach.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * `ApiKeyGuard` used to synthesise `ALL_SELLER_PERMISSION_KEYS` minus
 * `roles.manage` for every key — the built-in Admin role, handed to a
 * credential a seller pastes into somebody else's software. That is a
 * machine token that can request a withdrawal, change the bank account
 * the withdrawal is sent to, invite a colleague, and mint more keys. It
 * has never been reachable, because the guard is wired to no controller
 * (nothing in the codebase carries `@UseGuards(ApiKeyGuard)`), so the
 * keys the seller UI mints authenticate nothing at all. Fixing the grant
 * BEFORE the first controller is attached is the only order in which
 * this is cheap: a key that has been issued cannot be un-issued.
 *
 * ── WHY SCOPES AND NOT THE ROLE SYSTEM ───────────────────────────────
 * A key belongs to a COMPANY, not a person, so there is no role to read
 * it off. And the seller catalogue is per-capability because a human
 * ticks the boxes; an integration wants a handful of coarse choices it
 * can reason about at 2am. So the vocabulary here is deliberately
 * smaller, and each scope names the permissions it covers ONCE — the
 * `BinPolicyService` / `WarehouseResolverService` discipline, because a
 * second place deciding what `orders:read` means is how the two come to
 * disagree.
 *
 * ── THE CEILING IS THE ABSENCE OF A SCOPE ────────────────────────────
 * There is no scope covering the wallet, withdrawals, the company
 * profile and its bank account, the team, roles, other API keys,
 * webhooks, per-order charges, freight bills or reseller stores.
 * **Money and identity are not reachable by a machine key**, and that is
 * enforced by there being nothing to tick rather than by an operator
 * remembering not to tick it. Widening is always a deliberate act: add a
 * scope, and every key issued before it stays exactly as narrow as it
 * was.
 */
export interface SellerApiKeyScopeDef {
  /** Stable machine key. NEVER renamed — it is stored in the database. */
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly permissions: readonly SellerPermissionKey[];
}

export const SELLER_API_KEY_SCOPES = [
  {
    key: 'orders:read',
    label: 'Read orders',
    description: 'The order list, an order’s detail, and its tracking timeline.',
    permissions: ['orders.view'],
  },
  {
    key: 'orders:write',
    label: 'Place and cancel orders',
    description:
      'Create an order, edit one that is not confirmed yet, cancel one before it is packed, ' +
      'upload a batch as CSV, and work the draft queue. It also opens the customer check that ' +
      '`orders.create` carries — how many orders a phone number has had across the whole ' +
      'platform — which is why this is the widest scope on offer.',
    permissions: [
      'orders.create',
      'orders.cancel',
      'orders.import',
      'orders.pending.manage',
      'recipient_addresses.manage',
    ],
  },
  {
    key: 'customers:read',
    label: 'Read customers',
    description: 'The people this company’s orders have been sent to, and their history with it.',
    permissions: ['customers.view'],
  },
  {
    key: 'catalog:read',
    label: 'Read the catalogue',
    description: 'Products, their variants and their images.',
    permissions: ['catalog.view'],
  },
  {
    key: 'catalog:write',
    label: 'Edit the catalogue',
    description: 'Add and change products, variants and images, and upload them as CSV.',
    permissions: ['catalog.manage', 'catalog.import'],
  },
  {
    key: 'inventory:read',
    label: 'Read stock',
    description:
      'What is in the warehouse per SKU, and the inbound consignments sent to it. Read only — ' +
      'announcing a consignment is a commitment and stays a person’s act.',
    permissions: ['inventory.view', 'inbound.view'],
  },
  {
    key: 'tickets:read',
    label: 'Read issues',
    description: 'Damage and scrap tickets, and issues raised about a parcel.',
    permissions: ['tickets.view'],
  },
  {
    key: 'tickets:write',
    label: 'Raise an issue',
    description: 'Report a problem with a parcel and follow it to a resolution.',
    permissions: ['tickets.create'],
  },
] as const satisfies readonly SellerApiKeyScopeDef[];

export type SellerApiKeyScope = (typeof SELLER_API_KEY_SCOPES)[number]['key'];

export const ALL_SELLER_API_KEY_SCOPES: readonly SellerApiKeyScope[] = SELLER_API_KEY_SCOPES.map(
  (s) => s.key,
);

/**
 * Every permission the given scopes cover, deduped and in catalogue
 * order.
 *
 * **Unknown scope strings are DROPPED, not rejected.** A scope removed
 * in a later release leaves rows in the database naming it, and the
 * safe reading of a name we no longer understand is that it grants
 * nothing — never that the key falls back to something wider. A key
 * whose every scope has gone that way resolves to no permissions, which
 * `ApiKeyGuard` refuses by name rather than letting it 403 on each
 * endpoint in turn.
 */
export function permissionsForScopes(scopes: readonly string[]): readonly SellerPermissionKey[] {
  const granted = new Set<SellerPermissionKey>();
  for (const scope of scopes) {
    const def = SELLER_API_KEY_SCOPES.find((s) => s.key === scope);
    if (def === undefined) continue;
    for (const permission of def.permissions) granted.add(permission);
  }
  return ALL_SELLER_PERMISSION_KEYS.filter((k) => granted.has(k));
}
