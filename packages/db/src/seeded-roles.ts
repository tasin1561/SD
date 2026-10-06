// The roles every Skydrop database is seeded with, by `*_roles.key`.
//
// ── WHY THESE ARE CODE AND NOT AN ENUM COLUMN ───────────────────────
// `staff_users.role` and `seller_users.role` were Postgres enums naming
// a person's one role. Both are gone: a person holds SEVERAL roles, and
// an operator may invent one, so neither fact fits a column with a
// closed list of spellings. `*_user_roles` is the authority now.
//
// What the enums were still genuinely good for is NAMING a seeded role
// without a database round-trip — a test that wants a call agent, a
// screen that offers the standard set. That is what these are. They are
// the `key` of a row the migrations seed, so they are lowercase and
// they match the database exactly.
//
// ── THEY ARE NOT THE WHOLE LIST ─────────────────────────────────────
// Any role an operator invents has a key that is not here, and a person
// may hold it. Code that asks "may this person do X" must read their
// PERMISSIONS, never this list — a role name cannot answer it. These
// exist to point at a known row, nothing more.

/** The seven job-function roles plus the three access tiers. */
export const StaffRoleKey = {
  // Job function — what somebody does.
  SUPER_ADMIN: 'super_admin',
  SELLER_APPROVAL_ADMIN: 'seller_approval_admin',
  CALL_AGENT: 'call_agent',
  WAREHOUSE_STAFF: 'warehouse_staff',
  WAREHOUSE_SUPERVISOR: 'warehouse_supervisor',
  MANUAL_PLACEMENT_ADMIN: 'manual_placement_admin',
  FINANCE: 'finance',
  // Access tier — how much of it. Held ALONGSIDE a job function, which
  // is why a single column could never say both.
  ADMIN: 'admin',
  SUPPORT: 'support',
  READONLY: 'readonly',
} as const;

export type StaffRoleKeyName = keyof typeof StaffRoleKey;
export type StaffRoleKeyValue = (typeof StaffRoleKey)[StaffRoleKeyName];

/** Created with every seller account. Scoped by `seller_id`. */
export const SellerRoleKey = {
  OWNER: 'owner',
  ADMIN: 'admin',
  OPS: 'ops',
  INVENTORY: 'inventory',
  FINANCE: 'finance',
  VIEWER: 'viewer',
} as const;

export type SellerRoleKeyName = keyof typeof SellerRoleKey;
export type SellerRoleKeyValue = (typeof SellerRoleKey)[SellerRoleKeyName];

/** Created with every reseller store. Scoped by `store_id`. */
export const StoreRoleKey = {
  OWNER: 'owner',
  ADMIN: 'admin',
  OPS: 'ops',
  FINANCE: 'finance',
  VIEWER: 'viewer',
} as const;

export type StoreRoleKeyName = keyof typeof StoreRoleKey;
export type StoreRoleKeyValue = (typeof StoreRoleKey)[StoreRoleKeyName];
