import { ALL_PERMISSION_KEYS, PERMISSIONS, type PermissionKey } from './permissions';

/**
 * The three ACCESS TIERS the staff catalogue was missing.
 *
 * ── WHY TIERS AND JOB FUNCTIONS BOTH ────────────────────────────────
 * The seven seeded roles are JOB FUNCTIONS — Call agent, Warehouse
 * staff, Warehouse supervisor, Finance — and they stay, because they
 * encode distinctions a tier ladder cannot: picking versus supervising,
 * who may close a manifest, who may collapse a warehouse's bins. What
 * was missing is the other axis: "everything short of who-has-access",
 * "the support desk", "look but do not touch". Neither axis is a
 * refinement of the other, which is why a person may now hold several
 * roles (`staff_user_roles`) and the guard resolves the UNION: somebody
 * who takes calls AND handles tickets holds Call agent and Support
 * rather than having a bespoke role invented for them.
 *
 * ── DERIVED, NOT TRANSCRIBED ────────────────────────────────────────
 * Each set is computed from the catalogue, so a permission added next
 * release lands in the right tiers by construction instead of waiting
 * for somebody to remember three lists. Hand-copying seventy keys is
 * how a tier silently stops meaning what its name says.
 *
 * The migration that SEEDS these roles cannot import TypeScript, so it
 * carries the derived rows as literal SQL and
 * `staff-role-presets.spec.ts` compares the two IN BOTH DIRECTIONS.
 * That spec is the only thing standing between this file and the
 * database disagreeing about what "Admin" means.
 */

/**
 * Who-has-access, and the company's financial identity. An Admin runs
 * the platform; it does not decide who else may, and it does not touch
 * where money goes.
 *
 * Mirrors the posture a courier's own panel takes ("Admin cannot
 * configure company and bank details, or view and create users"): the
 * accounts we pay sellers into, the accounts sellers pay us into, and
 * the staff list are a different kind of trust from running operations.
 */
const ADMIN_EXCLUDES_ACCESS_AND_BANKING: readonly PermissionKey[] = [
  'staff.view',
  'staff.manage',
  'rbac.manage',
  'money.bank_accounts.manage',
  'sellers.bank_account.reveal',
  'sellers.bank_change.approve',
];

/**
 * The five CLAUDE.md marks SUPER_ADMIN-by-construction rather than
 * merely dangerous — each one bypasses an invariant the rest of the
 * system is built on, and each is documented as belonging to one
 * person.
 *
 * Deliberately NOT "every `dangerous: true` key": an Admin must be able
 * to resolve a ticket, record a remittance and cancel a parcel at the
 * courier, all of which are dangerous and all of which are the job.
 * Dangerous means "confirm twice", not "nobody but the owner".
 */
const ADMIN_EXCLUDES_INVARIANT_BYPASSES: readonly PermissionKey[] = [
  'orders.override', // ORD-2 god mode
  'warehouse.bins.collapse', // BIN-4
  'money.pnl.god_mode', // PNL-CF-1
  'money.wallet.transfer', // TRE-8b
  'reseller.credit_after_confirmation.enable', // RS-4
];

/** A read key by NAME, which is the only honest test available. */
function isViewKey(key: PermissionKey): boolean {
  return key.endsWith('.view');
}

export interface StaffRolePreset {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly PermissionKey[];
}

const ADMIN_EXCLUDED = new Set<string>([
  ...ADMIN_EXCLUDES_ACCESS_AND_BANKING,
  ...ADMIN_EXCLUDES_INVARIANT_BYPASSES,
]);

export const STAFF_ROLE_PRESETS: readonly StaffRolePreset[] = [
  {
    key: 'admin',
    name: 'Admin',
    description:
      'Runs the platform: orders, the warehouse, couriers, sellers and the money that moves ' +
      'through it. Not who has access, not our bank accounts or a seller’s, and none of the ' +
      'five overrides that bypass an invariant.',
    permissions: ALL_PERMISSION_KEYS.filter((key) => !ADMIN_EXCLUDED.has(key)),
  },
  {
    key: 'support',
    name: 'Support',
    description:
      'Answers for what went wrong: reads orders, parcels, sellers and stores, works the ticket ' +
      'queue, and can open the system-issues page a problem notification points at. Changes ' +
      'nothing operational.',
    permissions: [
      'orders.view',
      'tickets.view',
      'tickets.resolve',
      'courier.ops.view',
      'warehouse.view',
      'sellers.view',
      'reseller.stores.view',
      'callcenter.queue.view',
      // The door this opens is `/system-issues` (NOTIF-16: every
      // system-issue audience holds this key, because a notification
      // pointing at a page the reader cannot open is a dead end — and
      // support IS the audience for "something broke"). It also opens
      // the settings page, read-only; CHANGING a setting is
      // `system.settings.manage`, which support does not hold.
      //
      // Known hazard, not introduced here: `GET /admin/system-settings/:key`
      // returns the RAW value even for a row marked `is_sensitive`, so
      // the day a setting is seeded sensitive this key starts revealing
      // it. Nothing is marked sensitive today.
      'system.settings.view',
    ],
  },
  {
    key: 'readonly',
    name: 'Read-only',
    description:
      'Sees everything and changes nothing — every read in the catalogue and no write at all. ' +
      'For an auditor, an analyst, or somebody being shown round.',
    // Every `.view` key and nothing else. `sellers.bank_account.reveal`
    // reads data and is deliberately NOT here: it is not a view key, it
    // is the key that puts a seller's account number on a screen, and
    // every use of it is audited because of that.
    permissions: ALL_PERMISSION_KEYS.filter(isViewKey),
  },
];

/** A preset's keys, for the spec and for anything generating the SQL. */
export function presetPermissions(key: string): readonly PermissionKey[] {
  const found = STAFF_ROLE_PRESETS.find((p) => p.key === key);
  if (found === undefined) throw new Error(`Unknown staff role preset: ${key}`);
  return found.permissions;
}

/**
 * Keys an Admin does not hold, with the reason, for the spec and for
 * whoever asks why later.
 */
export const ADMIN_WITHHELD: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key).filter((k) =>
  ADMIN_EXCLUDED.has(k),
);
