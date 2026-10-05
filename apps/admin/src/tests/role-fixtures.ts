import type { StaffUserRow } from '@skydrop/api-client';
import type { StaffRole } from '@skydrop/db';
import type { Catalogue, RoleView } from '@/lib/rbac-hooks';

/**
 * A role list of the shape production now has: a superuser, the three
 * ACCESS TIERS, three of the seeded JOB FUNCTIONS, and one a team
 * invented. Ten is what the real catalogue holds, and the point of
 * these fixtures is that the screens cope with ten rather than with the
 * seven that used to be hardcoded in the invite form.
 */
export const ROLES: readonly RoleView[] = [
  {
    id: 'r-super',
    key: 'super_admin',
    name: 'Super admin',
    description: 'Everything, including future permissions.',
    isSystem: true,
    isSuperAdmin: true,
    permissions: ['orders.view', 'orders.cancel', 'staff.manage', 'rbac.manage'],
    staffCount: 1,
  },
  {
    id: 'r-admin',
    key: 'admin',
    name: 'Admin',
    description: 'Runs the platform. Not who has access.',
    isSystem: true,
    isSuperAdmin: false,
    permissions: ['orders.view', 'orders.cancel'],
    staffCount: 2,
  },
  {
    id: 'r-support',
    key: 'support',
    name: 'Support',
    description: 'Answers for what went wrong.',
    isSystem: true,
    isSuperAdmin: false,
    permissions: ['orders.view', 'tickets.view'],
    staffCount: 1,
  },
  {
    id: 'r-readonly',
    key: 'readonly',
    name: 'Read-only',
    description: 'Sees everything, changes nothing.',
    isSystem: true,
    isSuperAdmin: false,
    permissions: ['orders.view'],
    staffCount: 0,
  },
  {
    id: 'r-call',
    key: 'call_agent',
    name: 'Call agent',
    description: 'Works the call queue.',
    isSystem: true,
    isSuperAdmin: false,
    permissions: ['callcenter.work'],
    staffCount: 3,
  },
  {
    id: 'r-wh',
    key: 'warehouse_staff',
    name: 'Warehouse staff',
    description: 'Picks and packs.',
    isSystem: true,
    isSuperAdmin: false,
    permissions: ['warehouse.pick', 'warehouse.pack'],
    staffCount: 4,
  },
  {
    id: 'r-fin',
    key: 'finance',
    name: 'Finance',
    description: 'Wallets, payouts, settlements.',
    isSystem: true,
    isSuperAdmin: false,
    permissions: ['money.view'],
    staffCount: 1,
  },
  {
    id: 'r-returns',
    key: 'returns_desk',
    name: 'Returns desk',
    description: 'A role this team invented.',
    isSystem: false,
    isSuperAdmin: false,
    permissions: ['warehouse.rto.finalize'],
    staffCount: 0,
  },
];

export const CATALOGUE: Catalogue = {
  groups: ['Orders', 'Warehouse'],
  permissions: [
    {
      key: 'orders.view',
      label: 'View orders',
      description: 'The order list.',
      group: 'Orders',
      dangerous: false,
    },
    {
      key: 'orders.cancel',
      label: 'Cancel an order',
      description: 'Call an order off.',
      group: 'Orders',
      dangerous: true,
    },
    {
      key: 'tickets.view',
      label: 'View tickets',
      description: 'The ticket queue.',
      group: 'Orders',
      dangerous: false,
    },
    {
      key: 'callcenter.work',
      label: 'Work the call queue',
      description: 'Pull and log calls.',
      group: 'Orders',
      dangerous: false,
    },
    {
      key: 'warehouse.pick',
      label: 'Pick',
      description: 'Pull stock for a parcel.',
      group: 'Warehouse',
      dangerous: false,
    },
    {
      key: 'warehouse.pack',
      label: 'Pack',
      description: 'Seal a box.',
      group: 'Warehouse',
      dangerous: true,
    },
    {
      key: 'warehouse.rto.finalize',
      label: 'Finalise a return',
      description: 'Restock or write off.',
      group: 'Warehouse',
      dangerous: true,
    },
    {
      key: 'money.view',
      label: 'See money',
      description: 'Wallets and payouts.',
      group: 'Orders',
      dangerous: false,
    },
    {
      key: 'staff.manage',
      label: 'Manage staff',
      description: 'Invite and re-role.',
      group: 'Orders',
      dangerous: true,
    },
    {
      key: 'rbac.manage',
      label: 'Manage roles',
      description: 'Create roles.',
      group: 'Orders',
      dangerous: true,
    },
  ],
};

function staffRow(over: Partial<StaffUserRow> & Pick<StaffUserRow, 'id'>): StaffUserRow {
  return {
    email: `${over.id}@skydrop.test`,
    emailDisplay: `${over.id}@skydrop.test`,
    role: null,
    roleId: '',
    roleName: '',
    roleIds: [],
    roleNames: [],
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

/**
 * One person on TWO roles — a job function plus an access tier, which is
 * the shape the whole change exists for — and one on NONE, which is a
 * real state: every role they held was soft-deleted, and the guard
 * answers UNAUTHORIZED for them.
 */
export const USERS: readonly StaffUserRow[] = [
  staffRow({
    id: 'u-two-roles',
    role: 'CALL_AGENT' as StaffRole,
    roleId: 'r-call',
    roleName: 'Call agent',
    roleIds: ['r-call', 'r-support'],
    roleNames: ['Call agent', 'Support'],
  }),
  staffRow({ id: 'u-no-roles' }),
];

export const NO_INVITATIONS = { items: [] as unknown[], total: 0 };
