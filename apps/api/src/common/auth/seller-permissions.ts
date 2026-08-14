/**
 * What a member of a SELLER's team can be allowed to do.
 *
 * The staff catalogue's twin (`permissions.ts`), and the same split for
 * the same reason: permissions are CODE because a line of code checks
 * each one; roles are DATA so a company can invent "Warehouse clerk"
 * and decide what it covers without a deploy.
 *
 * ── ONE DIFFERENCE THAT MATTERS: ROLES ARE PER SELLER ────────────────
 * Staff roles are global — there is one Skydrop. Seller roles belong to
 * a company: Dhaka Threads' "Manager" has nothing to do with anybody
 * else's, and one seller editing a role must never change another's. So
 * `seller_roles` carries a `seller_id` and every lookup is scoped by it.
 * Six defaults are created for each company so the day it signs up looks
 * exactly like the day before this existed.
 *
 * ── GRANULARITY ──────────────────────────────────────────────────────
 * Per capability, like the staff side: nameable in plain words by the
 * owner ticking the box. "See orders" and "Place an order" are separate
 * because the difference is the whole point of giving somebody a
 * read-only login.
 *
 * ── THE PREVIOUS SYSTEM, AND WHAT IT COULD NOT SAY ───────────────────
 * Six fixed roles where five of them (OWNER/ADMIN/OPS/INVENTORY/
 * FINANCE) saw EVERYTHING and differed only in what they could change,
 * and VIEWER had a hand-maintained read allow-list. There was no way to
 * express "this person handles inbound stock and must not see the
 * wallet" — which is the ordinary case for a company with staff.
 */

export interface SellerPermissionDef {
  /** Stable machine key. NEVER renamed — it is stored in the database. */
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly group: SellerPermissionGroup;
  /** Moves money, or exposes something a company would not show everyone. */
  readonly sensitive?: true;
}

export const SELLER_PERMISSION_GROUPS = [
  'Orders',
  'Catalogue',
  'Inventory',
  'Money',
  'Support',
  'Company',
] as const;

export type SellerPermissionGroup = (typeof SELLER_PERMISSION_GROUPS)[number];

export const SELLER_PERMISSIONS = [
  // ── Orders ─────────────────────────────────────────────────────────
  {
    key: 'orders.view',
    label: 'See orders',
    description: 'The order list, an order’s detail, and its tracking timeline.',
    group: 'Orders',
  },
  {
    key: 'orders.create',
    label: 'Place an order',
    description: 'Enter a new order by hand, and edit one that has not been confirmed yet.',
    group: 'Orders',
  },
  {
    key: 'orders.cancel',
    label: 'Cancel an order',
    description: 'Stop an order before it is packed. Releases any stock held for it.',
    group: 'Orders',
  },
  {
    key: 'orders.import',
    label: 'Upload orders from a file',
    description: 'Bring in a batch of orders as CSV, and manage the column mappings.',
    group: 'Orders',
  },
  {
    key: 'orders.pending.manage',
    label: 'Work the draft queue',
    description: 'Review orders waiting to be submitted, and submit or discard them.',
    group: 'Orders',
  },
  {
    key: 'customers.view',
    label: 'See customers',
    description: 'The people orders have been sent to, and their history with you.',
    group: 'Orders',
    sensitive: true,
  },
  {
    // Split out of customers.view, which was guarding the edit and the
    // soft delete as well as the read. A role granted "See customers"
    // could rename and remove customer records, so a company could not
    // express "let them look" — the only way to withhold the write was
    // to withhold the read.
    key: 'customers.manage',
    label: 'Edit customers',
    description:
      'Correct a name, email or note, and remove a customer. The phone number is fixed — it is how a customer is identified.',
    group: 'Orders',
    sensitive: true,
  },
  {
    key: 'recipient_addresses.manage',
    label: 'Keep a customer address book',
    description: 'Saved delivery addresses to reuse when placing an order.',
    group: 'Orders',
  },

  // ── Catalogue ──────────────────────────────────────────────────────
  {
    key: 'catalog.view',
    label: 'See the catalogue',
    description: 'Products, their variants and their images.',
    group: 'Catalogue',
  },
  {
    key: 'catalog.manage',
    label: 'Edit the catalogue',
    description:
      'Add and change products, variants and images. A SKU code is fixed once it exists.',
    group: 'Catalogue',
  },
  {
    key: 'catalog.import',
    label: 'Upload the catalogue from a file',
    description: 'Bring products and variants in as CSV.',
    group: 'Catalogue',
  },

  // ── Inventory ──────────────────────────────────────────────────────
  {
    key: 'inventory.view',
    label: 'See stock',
    description: 'What is in the warehouse, per SKU, and the serials behind it.',
    group: 'Inventory',
  },
  {
    key: 'inbound.view',
    label: 'See inbound consignments',
    description: 'Shipments sent to the warehouse and what was received against them.',
    group: 'Inventory',
  },
  {
    key: 'inbound.manage',
    label: 'Send stock to the warehouse',
    description: 'Announce a consignment so the warehouse knows to expect it.',
    group: 'Inventory',
  },
  {
    key: 'holds.manage',
    label: 'Decide on held stock',
    description:
      'When the call centre could not reach a customer, choose whether to keep holding their stock or release it.',
    group: 'Inventory',
  },

  // ── Money ──────────────────────────────────────────────────────────
  {
    key: 'wallet.view',
    label: 'See the wallet',
    description: 'The balance and every entry in the ledger.',
    group: 'Money',
    sensitive: true,
  },
  {
    key: 'wallet.topup',
    label: 'Declare a top-up',
    description:
      'Tell us a bank transfer was sent. Nothing is credited until somebody has seen it arrive.',
    group: 'Money',
    sensitive: true,
  },
  {
    key: 'wallet.withdraw',
    label: 'Request a payout',
    description: 'Ask for money to be sent to your bank account.',
    group: 'Money',
    sensitive: true,
  },
  {
    key: 'charges.view',
    label: 'See what an order cost',
    description: 'The per-order charge breakdown, and its invoice.',
    group: 'Money',
    sensitive: true,
  },
  {
    key: 'freight.view',
    label: 'See inbound freight bills',
    description: 'What the cross-border leg cost, and how much of it is still owed.',
    group: 'Money',
    sensitive: true,
  },

  // ── Support ────────────────────────────────────────────────────────
  {
    key: 'tickets.view',
    label: 'See issues',
    description: 'Damage and scrap tickets, and issues raised about a parcel.',
    group: 'Support',
  },
  {
    key: 'tickets.create',
    label: 'Raise an issue',
    description: 'Report a problem with a parcel and follow it to a resolution.',
    group: 'Support',
  },

  // ── Company ────────────────────────────────────────────────────────
  {
    key: 'profile.view',
    label: 'See the company profile',
    description: 'Company details, documents and onboarding progress.',
    group: 'Company',
  },
  {
    key: 'profile.manage',
    label: 'Edit the company profile',
    description: 'Company details and the bank account payouts are sent to.',
    group: 'Company',
    sensitive: true,
  },
  {
    key: 'addresses.manage',
    label: 'Manage pickup addresses',
    description: 'Where in Bangladesh your stock is collected from.',
    group: 'Company',
  },
  {
    key: 'team.view',
    label: 'See the team',
    description: 'Who has a login for this company and what they may do.',
    group: 'Company',
  },
  {
    key: 'team.manage',
    label: 'Manage the team',
    description: 'Invite a colleague, change what somebody may do, or remove their access.',
    group: 'Company',
    sensitive: true,
  },
  {
    key: 'roles.manage',
    label: 'Manage roles',
    description:
      'Create roles for your team and decide what each covers — including this one. Anybody holding it can grant themselves anything.',
    group: 'Company',
    sensitive: true,
  },
  {
    key: 'api_keys.manage',
    label: 'Manage API keys',
    description: 'Keys that let your own systems talk to Skydrop. A key is shown once.',
    group: 'Company',
    sensitive: true,
  },
  {
    key: 'webhooks.manage',
    label: 'Manage webhooks',
    description: 'Where we send order updates so your systems hear about them.',
    group: 'Company',
    sensitive: true,
  },
  {
    key: 'notifications.manage',
    label: 'Set notification preferences',
    description: 'Which emails this company receives, and about what.',
    group: 'Company',
  },
] as const satisfies readonly SellerPermissionDef[];

export type SellerPermissionKey = (typeof SELLER_PERMISSIONS)[number]['key'];

export const ALL_SELLER_PERMISSION_KEYS: readonly SellerPermissionKey[] = SELLER_PERMISSIONS.map(
  (p) => p.key,
);

const KEY_SET = new Set<string>(ALL_SELLER_PERMISSION_KEYS);

export function isSellerPermissionKey(value: string): value is SellerPermissionKey {
  return KEY_SET.has(value);
}

/**
 * The six roles every company starts with, and what each covers.
 *
 * They reproduce what the old fixed enum did, so a company that never
 * opens the roles screen sees no change. The difference is that these
 * are now a STARTING POINT rather than the whole vocabulary.
 *
 * OWNER is absent on purpose: it holds everything implicitly, the same
 * way the staff super-admin role does, so a permission added in a later
 * release reaches it without a data migration anybody has to remember.
 */
export const DEFAULT_SELLER_ROLES: ReadonlyArray<{
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly isOwner?: true;
  readonly permissions: readonly SellerPermissionKey[];
}> = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Everything, including permissions added later. Cannot be edited or deleted.',
    isOwner: true,
    permissions: [],
  },
  {
    key: 'admin',
    name: 'Admin',
    description: 'Everything except managing roles.',
    permissions: ALL_SELLER_PERMISSION_KEYS.filter((k) => k !== 'roles.manage'),
  },
  {
    key: 'ops',
    name: 'Operations',
    description: 'Orders, the catalogue and stock. No money, no team.',
    permissions: [
      'orders.view',
      'orders.create',
      'orders.cancel',
      'orders.import',
      'orders.pending.manage',
      'customers.view',
      'customers.manage',
      'recipient_addresses.manage',
      'catalog.view',
      'catalog.manage',
      'catalog.import',
      'inventory.view',
      'inbound.view',
      'holds.manage',
      'tickets.view',
      'tickets.create',
      'profile.view',
      'addresses.manage',
    ],
  },
  {
    key: 'inventory',
    name: 'Inventory',
    description: 'Stock and inbound consignments, and the catalogue behind them.',
    permissions: [
      'orders.view',
      'catalog.view',
      'catalog.manage',
      'catalog.import',
      'inventory.view',
      'inbound.view',
      'inbound.manage',
      'holds.manage',
      'tickets.view',
      'tickets.create',
      'profile.view',
      'addresses.manage',
    ],
  },
  {
    key: 'finance',
    name: 'Finance',
    description: 'The wallet, payouts, charges and freight.',
    permissions: [
      'orders.view',
      'charges.view',
      'wallet.view',
      'wallet.topup',
      'wallet.withdraw',
      'freight.view',
      'tickets.view',
      'profile.view',
      'profile.manage',
      'notifications.manage',
    ],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only, and only the orders. The narrowest login there is.',
    permissions: ['orders.view'],
  },
];
