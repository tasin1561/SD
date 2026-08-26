/**
 * The permission catalogue — the closed set of things a staff member can
 * be allowed to do.
 *
 * ── WHY THIS IS CODE AND ROLES ARE DATA ──────────────────────────────
 * A permission is referenced by a line of code: an endpoint either
 * declares `orders.override` or it does not, and no runtime edit can
 * change that. So the list of permissions lives here, in the repo,
 * reviewed like any other code.
 *
 * A ROLE is nothing but a named bundle of these keys, and that is
 * data — `staff_roles` + `staff_role_permissions`, created, edited and
 * deleted by an admin with no deploy. That split is what makes "invent
 * a Manager role and tick what it may do" possible WITHOUT making the
 * codebase's guarantees unverifiable.
 *
 * The alternative — code checking role NAMES that an admin can create
 * and delete — was rejected deliberately. Twelve invariants in
 * CLAUDE.md name a specific role (WMS-6 manifest close, CUR-4 dispatch
 * handoff, CUR-8 manual placement, BIN-4 collapse, TRK-9 manual scan).
 * If those roles were rows, deleting one would silently turn its
 * invariant into a check against a name nothing holds. Expressed as
 * permissions, the guarantee survives any amount of role editing.
 *
 * ── GRANULARITY: PER CAPABILITY ──────────────────────────────────────
 * Not per page (too coarse to express "may see orders, may not cancel
 * one") and not per endpoint (188 of them — precise and unusable by the
 * human ticking boxes). The rule of thumb: a permission must be
 * nameable in plain words on a settings screen. If you cannot write its
 * label without saying "and", it is two permissions.
 *
 * ── ADDING ONE ───────────────────────────────────────────────────────
 * Add it here, give it a `label` and a `description` that make sense to
 * whoever is deciding, then declare it on the handler(s) it guards.
 * `staff-permission-surface.spec.ts` fails if a handler declares a
 * permission this file does not define, or if a handler declares none
 * at all — the fail-closed rule, enforced structurally rather than
 * remembered.
 *
 * ── DANGEROUS ────────────────────────────────────────────────────────
 * `dangerous: true` marks the permissions that move money, touch the
 * physical world, or bypass an invariant. It changes nothing about
 * enforcement — every permission is enforced identically — but the
 * management UI puts them behind a separate confirmation, because the
 * difference between "may view settlements" and "may cancel a moving
 * parcel" should not be two adjacent unremarkable checkboxes.
 */

export interface PermissionDef {
  /** Stable machine key. NEVER renamed — it is stored in the database. */
  readonly key: string;
  /** What the person ticking the box reads. */
  readonly label: string;
  /** Why they might or might not tick it. */
  readonly description: string;
  /** Section heading in the management UI. */
  readonly group: PermissionGroup;
  /** Moves money, reaches the physical world, or bypasses an invariant. */
  readonly dangerous?: true;
}

export const PERMISSION_GROUPS = [
  'Orders',
  'Call centre',
  'Warehouse',
  'Inventory',
  'Couriers',
  'Sellers',
  'Money',
  'Pricing',
  'Support',
  'System',
] as const;

export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export const PERMISSIONS = [
  // ── Orders ─────────────────────────────────────────────────────────
  {
    key: 'orders.view',
    label: 'View orders',
    description: 'The order list, an order’s detail, and its lifecycle timeline.',
    group: 'Orders',
  },
  {
    key: 'orders.cancel',
    label: 'Cancel an order',
    description:
      'The ordinary cancel, which the lifecycle state machine still has to allow. Releases stock.',
    group: 'Orders',
  },
  {
    key: 'orders.override',
    label: 'God-mode override',
    description:
      'Force an order into any status and edit its fields, bypassing the state machine. Leaves a permanent mark on the order and a CRITICAL audit row. Also covers releasing reservations by hand.',
    group: 'Orders',
    dangerous: true,
  },
  {
    key: 'orders.charges.view',
    label: 'View order charges',
    description: 'The per-order cost breakdown.',
    group: 'Orders',
  },
  {
    key: 'orders.charges.compute',
    label: 'Compute order charges',
    description: 'Price an order and persist the result. Charges are never recomputed after this.',
    group: 'Orders',
  },
  {
    key: 'orders.tracking.run_poll',
    label: 'Run the tracking poll now',
    description:
      'Force a tracking cycle instead of waiting for the next scheduled one. Safe to press repeatedly — a cycle only applies scans newer than what each parcel already has.',
    group: 'Orders',
  },
  {
    key: 'orders.tracking.manual_scan',
    label: 'Record a tracking scan by hand',
    description:
      'Enter a courier scan the webhook never delivered. Drives the same order transitions a real scan would.',
    group: 'Orders',
    dangerous: true,
  },

  // ── Call centre ────────────────────────────────────────────────────
  {
    key: 'callcenter.work',
    label: 'Work the call queue',
    description:
      'Pull the next order to call, log an attempt, and set your own availability. This is the agent’s own station.',
    group: 'Call centre',
  },
  {
    key: 'callcenter.queue.view',
    label: 'View the call queue',
    description: 'Who is waiting to be called and how long they have waited.',
    group: 'Call centre',
  },
  {
    key: 'callcenter.queue.manage',
    label: 'Manage the call queue',
    description: 'Re-queue an order, or expire an assignment that an agent is sitting on.',
    group: 'Call centre',
  },
  {
    key: 'callcenter.agents.manage',
    label: 'Manage call agents',
    description: 'Another agent’s availability and per-agent settings.',
    group: 'Call centre',
  },

  // ── Warehouse ──────────────────────────────────────────────────────
  {
    key: 'warehouse.view',
    label: 'View warehouses',
    description: 'Warehouses, zones, bins and what is standing in them.',
    group: 'Warehouse',
  },
  {
    key: 'warehouse.manage',
    label: 'Manage warehouses and bins',
    description: 'Create and edit warehouses, zones and bins, and set bin tracking.',
    group: 'Warehouse',
  },
  {
    key: 'warehouse.bins.collapse',
    label: 'Collapse a warehouse’s bins',
    description:
      'Merge every bin into FLOOR. Destructive and only partly reversible — stock sells while a restore runs.',
    group: 'Warehouse',
    dangerous: true,
  },
  {
    key: 'warehouse.pick',
    label: 'Pick',
    description: 'The picker’s station: claim a parcel, scan items, finish the pick.',
    group: 'Warehouse',
  },
  {
    key: 'warehouse.pack',
    label: 'Pack',
    description: 'The packer’s station: open a box, scan items in, close it.',
    group: 'Warehouse',
  },
  {
    key: 'warehouse.pick.supervise',
    label: 'Supervise picking',
    description: 'Force-expire a pick somebody else claimed and left.',
    group: 'Warehouse',
  },
  {
    key: 'warehouse.manifest.close',
    label: 'Close a manifest',
    description:
      'Seal the day’s parcels for a courier. Triggers AWB generation and cannot be reopened.',
    group: 'Warehouse',
    dangerous: true,
  },
  {
    key: 'warehouse.rto.receive',
    label: 'Receive a return',
    description: 'Book a returned parcel in at the warehouse. Charges the seller the RTO fee.',
    group: 'Warehouse',
  },
  {
    key: 'warehouse.rto.inspect',
    label: 'Inspect a return',
    description:
      'Record the condition of each returned item, raising a ticket where it is damaged.',
    group: 'Warehouse',
  },
  {
    key: 'warehouse.rto.finalize',
    label: 'Finalise a return',
    description:
      'Decide restock or write-off per item. Write-off permanently removes stock and cannot be undone.',
    group: 'Warehouse',
    dangerous: true,
  },
  {
    key: 'warehouse.rto.putaway',
    label: 'Put returned stock away',
    description: 'Move a received return out of the hold bin and onto a shelf, making it sellable.',
    group: 'Warehouse',
  },

  // ── Inventory ──────────────────────────────────────────────────────
  {
    key: 'inventory.view',
    label: 'View stock',
    description: 'Levels, the movement ledger, transfers, and per-unit serials.',
    group: 'Inventory',
  },
  {
    key: 'inventory.adjustments.create',
    label: 'Raise a stock adjustment',
    description:
      'Correct a quantity. Below the value threshold this applies immediately; above it, it waits for approval.',
    group: 'Inventory',
  },
  {
    key: 'inventory.adjustments.approve',
    label: 'Approve a stock adjustment',
    description:
      'Release an above-threshold correction. The point of the threshold is that this is somebody else.',
    group: 'Inventory',
    dangerous: true,
  },
  {
    key: 'inventory.cycle_counts.manage',
    label: 'Run cycle counts',
    description: 'Open a count, record what was on the shelf, and post the variance.',
    group: 'Inventory',
  },
  {
    key: 'inventory.goods_receipts.manage',
    label: 'Receive inbound goods',
    description: 'Book a seller’s consignment into the warehouse and record its freight bill.',
    group: 'Inventory',
  },
  {
    key: 'inventory.transfers.manage',
    label: 'Transfer stock',
    description: 'Move stock between bins or warehouses.',
    group: 'Inventory',
  },

  // ── Couriers ───────────────────────────────────────────────────────
  {
    key: 'courier.dispatch.handoff',
    label: 'Hand parcels to the courier',
    description:
      'Confirm a manifest was collected. Dispatches every parcel on it and is when stock leaves for good.',
    group: 'Couriers',
    dangerous: true,
  },
  {
    key: 'courier.manual_placement',
    label: 'Place a parcel manually',
    description:
      'Record an AWB arranged outside the API for a parcel the courier refused, and dispatch it.',
    group: 'Couriers',
    dangerous: true,
  },
  {
    key: 'courier.accounts.view',
    label: 'View courier accounts',
    description:
      'Which accounts exist and which sellers route to them. Credentials are never shown.',
    group: 'Couriers',
  },
  {
    key: 'courier.accounts.manage',
    label: 'Manage courier accounts',
    description: 'Add an account, replace its credentials, and set how sellers are distributed.',
    group: 'Couriers',
    dangerous: true,
  },
  {
    key: 'courier.ops.view',
    label: 'Look up courier detail',
    description:
      'Expected transit time, real cost, proof of delivery, e-waybill status. Each of these spends a live API call.',
    group: 'Couriers',
  },
  {
    key: 'courier.ops.write',
    label: 'Act on a parcel at the courier',
    description:
      'Cancel it, edit its address, raise an e-waybill, or ask for another delivery attempt. These reach the physical world — a cancel turns a moving parcel into a return, and an NDR action sends a van.',
    group: 'Couriers',
    dangerous: true,
  },
  {
    key: 'courier.pickups.manage',
    label: 'Book courier pickups',
    description:
      'Request a van for a warehouse on a date. One open request per location per day, and a failed one keeps the slot.',
    group: 'Couriers',
  },
  {
    key: 'courier.margin.view',
    label: 'View lane margin',
    description: 'What we billed against what the courier actually charged.',
    group: 'Couriers',
  },
  {
    key: 'courier.waybills.manage',
    label: 'Manage the waybill pool',
    description:
      'See how many waybills are left and top the pool up. A refill spends the account’s real allocation.',
    group: 'Couriers',
  },

  // ── Sellers ────────────────────────────────────────────────────────
  {
    key: 'sellers.view',
    label: 'View sellers',
    description: 'The seller list and each seller’s profile, team and settings.',
    group: 'Sellers',
  },
  {
    key: 'sellers.approve',
    label: 'Approve or reject a seller',
    description: 'Let a registered seller into the platform, or turn them away.',
    group: 'Sellers',
  },
  {
    key: 'sellers.suspend',
    label: 'Suspend or reinstate a seller',
    description: 'Cut off a trading seller’s access, and give it back.',
    group: 'Sellers',
    dangerous: true,
  },
  {
    key: 'sellers.invite',
    label: 'Invite a seller',
    description: 'Issue and revoke invitations to the closed beta.',
    group: 'Sellers',
  },
  {
    key: 'sellers.settings.manage',
    label: 'Override a seller’s settings',
    description:
      'Give one seller different behaviour from the global default — call attempts, fees, accrual timing.',
    group: 'Sellers',
  },
  {
    key: 'sellers.courier_links.manage',
    label: 'Route a seller to courier accounts',
    description: 'Which courier accounts carry this seller’s parcels, and in what proportion.',
    group: 'Sellers',
  },
  {
    key: 'sellers.notes.manage',
    label: 'Keep notes on a seller',
    description: 'Internal notes on a seller’s record. Never shown to the seller.',
    group: 'Sellers',
  },
  {
    key: 'sellers.bank_account.reveal',
    label: 'Reveal a seller’s bank details',
    description:
      'Show the account we pay them into. Needed to send a remittance; every reveal is audited.',
    group: 'Sellers',
    dangerous: true,
  },
  {
    key: 'sellers.bank_change.approve',
    label: 'Approve a change of bank account',
    description:
      'Decide whether a seller may move where their money is sent. Approving redirects their withdrawals; rejecting requires a reason the seller reads.',
    group: 'Sellers',
    dangerous: true,
  },
  {
    key: 'leads.view',
    label: 'View invite requests',
    description: 'People who asked to be let in from the landing page.',
    group: 'Sellers',
  },
  {
    key: 'leads.manage',
    label: 'Work invite requests',
    description: 'Move a request through the queue and keep notes against it.',
    group: 'Sellers',
  },

  // ── Money ──────────────────────────────────────────────────────────
  {
    key: 'money.view',
    label: 'View the money surfaces',
    description:
      'Wallets, top-up claims, withdrawal requests, remittances, settlements and freight bills — read only.',
    group: 'Money',
  },
  {
    key: 'money.wallets.reconcile',
    label: 'Reconcile seller wallets',
    description:
      'Re-check every wallet against its own ledger and repair the cached balance. Reads and repairs only — it never changes a balance, so it cannot move money.',
    group: 'Money',
  },
  {
    key: 'money.topups.review',
    label: 'Accept or reject a top-up',
    description:
      'Confirm a seller’s bank transfer actually arrived. Accepting credits their wallet immediately.',
    group: 'Money',
    dangerous: true,
  },
  {
    key: 'money.withdrawals.review',
    label: 'Resolve a withdrawal request',
    description: 'Approve a seller’s withdrawal request by linking the remittance that paid it.',
    group: 'Money',
    dangerous: true,
  },
  {
    key: 'money.remittances.manage',
    label: 'Record a remittance',
    description: 'Log money actually sent to a seller. This is the only thing that pays anyone.',
    group: 'Money',
    dangerous: true,
  },
  {
    key: 'money.settlements.record',
    label: 'Record a courier settlement',
    description:
      'Log what a courier paid us and which orders it covered. Short payments become a permanent record.',
    group: 'Money',
    dangerous: true,
  },
  {
    key: 'money.freight.manage',
    label: 'Settle inbound freight',
    description: 'Charge or waive a seller’s cross-border freight bill.',
    group: 'Money',
    dangerous: true,
  },
  {
    key: 'money.bank_accounts.manage',
    label: 'Manage our bank accounts',
    description: 'The accounts sellers are told to transfer their top-ups into.',
    group: 'Money',
    dangerous: true,
  },

  // ── Pricing ────────────────────────────────────────────────────────
  {
    key: 'pricing.preview',
    label: 'Preview pricing',
    description: 'Work out what an order would be charged, without charging anything.',
    group: 'Pricing',
  },
  {
    key: 'fx.view',
    label: 'View exchange rates',
    description: 'Current rates and their history.',
    group: 'Pricing',
  },
  {
    key: 'fx.manage',
    label: 'Set an exchange rate',
    description:
      'Override the INR/BDT rate by hand. Every figure shown to a Bangladeshi seller is converted through it.',
    group: 'Pricing',
    dangerous: true,
  },

  // ── Support ────────────────────────────────────────────────────────
  {
    key: 'tickets.view',
    label: 'View tickets',
    description: 'Damage and scrap tickets, and issues sellers have raised.',
    group: 'Support',
  },
  {
    key: 'tickets.resolve',
    label: 'Resolve a ticket',
    description: 'Close a ticket, including by refunding the seller from the wallet.',
    group: 'Support',
    dangerous: true,
  },
  {
    key: 'holds.manage',
    label: 'Resolve stock holds',
    description:
      'Decide what happens to stock held for an order the call centre could not confirm — release it or keep trying.',
    group: 'Support',
  },

  // ── System ─────────────────────────────────────────────────────────
  {
    key: 'reports.view',
    label: 'View reports',
    description: 'Operational reporting.',
    group: 'System',
  },
  {
    key: 'webhooks.view',
    label: 'View webhook deliveries',
    description: 'What we sent a seller’s endpoint and what came back.',
    group: 'System',
  },
  {
    key: 'webhooks.retry',
    label: 'Retry a webhook delivery',
    description: 'Send a seller’s endpoint a payload again after it failed.',
    group: 'System',
  },
  {
    key: 'system.settings.view',
    label: 'View system settings',
    description: 'The runtime configuration every module reads.',
    group: 'System',
  },
  {
    key: 'system.settings.manage',
    label: 'Change system settings',
    description:
      'Edit that configuration. A single value here changes behaviour for every seller at once.',
    group: 'System',
    dangerous: true,
  },
  {
    key: 'system.capacity.view',
    label: 'View system limits',
    description: 'Database connections, disk, and how close each is to its ceiling.',
    group: 'System',
  },
  {
    key: 'staff.view',
    label: 'View staff',
    description: 'Who has an account and what they can do.',
    group: 'System',
  },
  {
    key: 'staff.manage',
    label: 'Manage staff',
    description: 'Invite a colleague, change someone’s role, or deactivate an account.',
    group: 'System',
    dangerous: true,
  },
  {
    key: 'rbac.manage',
    label: 'Manage roles and permissions',
    description:
      'Create roles and decide what each may do — including this permission. Anyone holding it can grant themselves anything.',
    group: 'System',
    dangerous: true,
  },
] as const satisfies readonly PermissionDef[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

/** Every key, for validation and for the "super admin holds everything" case. */
export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

const KEY_SET = new Set<string>(ALL_PERMISSION_KEYS);

export function isPermissionKey(value: string): value is PermissionKey {
  return KEY_SET.has(value);
}

export function permissionDef(key: PermissionKey): PermissionDef {
  const found = PERMISSIONS.find((p) => p.key === key);
  // Unreachable for a PermissionKey; the throw is for a raw string that
  // slipped past the type at a boundary.
  if (found === undefined) throw new Error(`Unknown permission: ${key}`);
  return found;
}
