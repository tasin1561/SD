import type { RoleView } from '@/lib/rbac-hooks';

/**
 * Which AXIS a staff role sits on, for grouping the roles list.
 *
 * ── WHY THERE ARE TWO AXES ───────────────────────────────────────────
 * The seven seeded roles are JOB FUNCTIONS — Call agent, Warehouse
 * staff, Finance — and they encode distinctions a ladder cannot: picking
 * versus supervising, who may close a manifest, who may collapse a
 * warehouse's bins. The three added in `20261005000100` are ACCESS
 * TIERS: "everything short of who-has-access", "the support desk", "look
 * but do not touch". Neither axis refines the other, which is exactly
 * why a person may hold several roles and the guard resolves the union.
 *
 * Ten rows of equal weight is where a list stops being scannable, so the
 * screen groups them. The grouping is the only thing this decides.
 *
 * ── THIS IS PRESENTATION, AND IT FAILS OPEN ──────────────────────────
 * `staff_roles` has no column saying which axis a role is on, so the
 * three tier keys are named here. That is a second copy of something the
 * server knows, and the usual objection applies — but the whole cost of
 * it being wrong is a role appearing under the wrong heading. Nothing is
 * filtered, nothing is gated, no permission is decided: a key this does
 * not recognise lands under "Job functions" (seeded) or "Roles you
 * created" (not), and is still rendered, still editable, still
 * assignable. `roles-axes.test.ts` pins that every role in a list comes
 * back in exactly one group.
 *
 * Replace it with a server-supplied field the day `RoleView` grows one.
 */
export type RoleAxis = 'superuser' | 'tier' | 'function' | 'custom';

/**
 * `staff_roles.key` for the three access tiers. Super admin is the top
 * of the same ladder but is identified by `isSuperAdmin`, which is a
 * real column — no need to name it here.
 */
const ACCESS_TIER_KEYS: ReadonlySet<string> = new Set(['admin', 'support', 'readonly']);

export function roleAxis(role: Pick<RoleView, 'key' | 'isSystem' | 'isSuperAdmin'>): RoleAxis {
  if (role.isSuperAdmin) return 'superuser';
  if (ACCESS_TIER_KEYS.has(role.key)) return 'tier';
  return role.isSystem ? 'function' : 'custom';
}

/** Headings and the sentence under each, in the order they are shown. */
export const ROLE_AXIS_GROUPS: readonly {
  readonly id: Exclude<RoleAxis, 'superuser'>;
  readonly title: string;
  readonly note: string;
  /** Axes that land in this group — superuser rides with the tiers. */
  readonly axes: readonly RoleAxis[];
}[] = [
  {
    id: 'tier',
    title: 'Access tiers',
    note: 'How much of the console somebody reaches. One of these is usually enough on its own.',
    axes: ['superuser', 'tier'],
  },
  {
    id: 'function',
    title: 'Job functions',
    note: 'What somebody actually does. Combine one with a tier — permissions are the union of every role held.',
    axes: ['function'],
  },
  {
    id: 'custom',
    title: 'Roles you created',
    note: 'Invented here, and as assignable as any seeded one.',
    axes: ['custom'],
  },
];

/** The roles for one group, in the order the server sent them. */
export function rolesInGroup(
  roles: readonly RoleView[],
  axes: readonly RoleAxis[],
): readonly RoleView[] {
  return roles.filter((r) => axes.includes(roleAxis(r)));
}

/**
 * How many distinct permissions a SET of roles grants between them.
 *
 * The union is what the server resolves, so it is the only honest answer
 * to "what will this person be able to do" — adding the per-role counts
 * double-counts everything two roles share, and a tier plus a job
 * function share a great deal. A super-admin role in the set means the
 * whole catalogue, including permissions added after today.
 */
export function unionPermissions(roles: readonly RoleView[]): {
  readonly count: number;
  readonly everything: boolean;
} {
  const everything = roles.some((r) => r.isSuperAdmin);
  const union = new Set<string>();
  for (const r of roles) for (const p of r.permissions) union.add(p);
  return { count: union.size, everything };
}
