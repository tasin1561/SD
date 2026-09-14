/**
 * What a member of a RESELLER STORE's team can be allowed to do (RS-2).
 *
 * The seller catalogue's twin (`seller-permissions.ts`), for the third
 * identity. Permissions are CODE because a line of code checks each one;
 * roles are DATA (`store_roles`), created per store at creation.
 *
 * ── A STORE USER SEES ONLY THEIR STORE ───────────────────────────────
 * Nothing here reaches the seller's account. Every store endpoint scopes
 * by the store id on the TOKEN, in the WHERE clause — never by an id in
 * the request — so a permission here is "may do X to MY store", never
 * "may do X". Phase 1 (docs/reseller-stores.md, RS-11 item 1) needs only
 * the store's own profile and team; later phases add orders, the wallet
 * and reports, each as its own key.
 */

export interface StorePermissionDef {
  /** Stable machine key. NEVER renamed — it is stored in the database. */
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly group: StorePermissionGroup;
  /** Exposes or changes something a store would not show everyone. */
  readonly sensitive?: true;
}

export const STORE_PERMISSION_GROUPS = ['Store', 'Team', 'Money'] as const;

export type StorePermissionGroup = (typeof STORE_PERMISSION_GROUPS)[number];

export const STORE_PERMISSIONS = [
  {
    key: 'store.profile.view',
    label: 'See the store profile',
    description: 'The store’s display name, logo and contact details.',
    group: 'Store',
  },
  {
    key: 'store.profile.manage',
    label: 'Edit the store profile',
    description: 'Change the display name customers see, the logo and the contact details.',
    group: 'Store',
  },
  {
    key: 'team.view',
    label: 'See the team',
    description: 'Who has a login for this store and what they may do.',
    group: 'Team',
  },
  {
    key: 'team.manage',
    label: 'Manage the team',
    description: 'Invite a colleague, change what somebody may do, or remove their access.',
    group: 'Team',
    sensitive: true,
  },
  // ── RS-6 — the store wallet ────────────────────────────────────────
  {
    key: 'wallet.view',
    label: 'See the wallet',
    description:
      'The store’s balance, every movement of it, and its top-up and withdrawal requests.',
    group: 'Money',
    sensitive: true,
  },
  {
    key: 'wallet.topups.manage',
    label: 'Top up the wallet',
    description:
      'Tell Skydrop about money sent to its bank for this store. Nothing is credited until Skydrop has seen it arrive. Only for a wallet Skydrop manages.',
    group: 'Money',
    sensitive: true,
  },
  {
    key: 'wallet.withdrawals.manage',
    label: 'Ask to withdraw',
    description:
      'Ask Skydrop to pay out the store’s balance, and say which bank account to pay it into. Only for a wallet Skydrop manages.',
    group: 'Money',
    sensitive: true,
  },
] as const satisfies readonly StorePermissionDef[];

export type StorePermissionKey = (typeof STORE_PERMISSIONS)[number]['key'];

export const ALL_STORE_PERMISSION_KEYS: readonly StorePermissionKey[] = STORE_PERMISSIONS.map(
  (p) => p.key,
);

const KEY_SET = new Set<string>(ALL_STORE_PERMISSION_KEYS);

export function isStorePermissionKey(value: string): value is StorePermissionKey {
  return KEY_SET.has(value);
}

/**
 * The five roles every reseller store starts with (RS-2).
 *
 * OWNER holds everything implicitly (like the seller and staff owner
 * roles), so a permission added in a later phase reaches it with no
 * backfill. The others are a STARTING POINT a later phase may let the
 * store edit; phase 1 has no role editor.
 */
export const DEFAULT_STORE_ROLES: ReadonlyArray<{
  readonly key: StoreRoleKey;
  readonly name: string;
  readonly description: string;
  readonly isOwner?: true;
  readonly permissions: readonly StorePermissionKey[];
}> = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Everything, including permissions added later.',
    isOwner: true,
    permissions: [],
  },
  {
    key: 'admin',
    name: 'Admin',
    description: 'Everything an owner can do today.',
    permissions: ALL_STORE_PERMISSION_KEYS,
  },
  {
    key: 'ops',
    name: 'Operations',
    description: 'Day-to-day work. Sees the store and its team; changes neither.',
    permissions: ['store.profile.view', 'team.view'],
  },
  {
    key: 'finance',
    name: 'Finance',
    description:
      'The money side: the wallet, top-ups and withdrawals. Sees the store and its team.',
    permissions: [
      'store.profile.view',
      'team.view',
      // RS-6. Also granted to existing finance roles by
      // 20260914230000_reseller_store_wallet.
      'wallet.view',
      'wallet.topups.manage',
      'wallet.withdrawals.manage',
    ],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only. The narrowest login there is.',
    permissions: ['store.profile.view'],
  },
];

export const STORE_ROLE_KEYS = ['owner', 'admin', 'ops', 'finance', 'viewer'] as const;
export type StoreRoleKey = (typeof STORE_ROLE_KEYS)[number];

export function isStoreRoleKey(value: string): value is StoreRoleKey {
  return (STORE_ROLE_KEYS as readonly string[]).includes(value);
}
