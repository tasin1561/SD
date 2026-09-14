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

export const STORE_PERMISSION_GROUPS = ['Store', 'Team', 'Catalogue', 'Terms'] as const;

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
  {
    // RS-3. Every role holds it by default (the owner implicitly): the
    // products a store may sell and their prices are what the whole team
    // works from. It shows the store's OWN terms only — never the
    // seller's cost, real stock, or anything about another store.
    key: 'catalogue.view',
    label: 'See the catalogue',
    description:
      'The products this store may sell, the price it pays for each, the retail range, and how many are available.',
    group: 'Catalogue',
  },
  // RS-4 — the seller's terms: who pays which Skydrop fee on the store's
  // orders, and when each side is credited.
  {
    key: 'terms.view',
    label: 'See the seller’s terms',
    description:
      'Who pays which Skydrop fee on this store’s orders, when the store and the seller are credited, and every earlier version.',
    group: 'Terms',
  },
  {
    // Deliberately not `terms.manage`: the store cannot change terms, only
    // agree to them on the store's behalf — and agreeing binds every
    // later order, which is why it is its own permission.
    key: 'terms.accept',
    label: 'Accept the seller’s terms',
    description:
      'Agree to a new version of the terms on the store’s behalf. Until somebody does, the store cannot place new orders.',
    group: 'Terms',
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
    description:
      'Day-to-day work. Sees the store, its team, its catalogue and its terms; changes none of them.',
    permissions: ['store.profile.view', 'team.view', 'catalogue.view', 'terms.view'],
  },
  {
    key: 'finance',
    name: 'Finance',
    description:
      'The money side, when it arrives. Sees the store, its team, its catalogue and its terms.',
    permissions: ['store.profile.view', 'team.view', 'catalogue.view', 'terms.view'],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only. The narrowest login there is.',
    // Terms are visible to everyone at the store: they decide what every
    // order costs, and the portal banner that says "new terms to accept"
    // must be able to read them for whoever is signed in.
    permissions: ['store.profile.view', 'catalogue.view', 'terms.view'],
  },
];

export const STORE_ROLE_KEYS = ['owner', 'admin', 'ops', 'finance', 'viewer'] as const;
export type StoreRoleKey = (typeof STORE_ROLE_KEYS)[number];

export function isStoreRoleKey(value: string): value is StoreRoleKey {
  return (STORE_ROLE_KEYS as readonly string[]).includes(value);
}
