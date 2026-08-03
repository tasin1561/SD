import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  PERMISSION_GROUPS,
  isPermissionKey,
  type PermissionGroup,
} from '../../../common/auth/permissions';

export interface RoleView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly isSuperAdmin: boolean;
  /** Empty for a super-admin role, which holds everything implicitly. */
  readonly permissions: readonly string[];
  /** How many people hold it — a role with holders cannot be deleted. */
  readonly staffCount: number;
}

export interface CatalogueEntry {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly group: PermissionGroup;
  readonly dangerous: boolean;
}

/**
 * Creating, editing and deleting roles.
 *
 * ── THE GUARDRAILS ARE THE SUBSTANCE ─────────────────────────────────
 * The CRUD here is unremarkable; what matters is what it refuses. Every
 * refusal below exists because the alternative is someone locking the
 * company out of its own admin console, and there is no support desk to
 * ring — this system's super admins are the only people who can undo
 * anything.
 *
 * Refusals:
 *  - The super-admin role cannot be edited or deleted. It is the way
 *    back in from any mistake made on this screen.
 *  - A seeded role cannot be deleted, because deleting the role every
 *    existing staff member holds is not an edit anybody means to make.
 *    Its permissions stay editable.
 *  - A role ANYBODY holds cannot be deleted. Reassigning them silently
 *    is how someone ends up with access nobody granted them.
 *  - `rbac.manage` cannot be taken off the last role that has it. That
 *    is the "sawing the branch" case, and it is one careless untick.
 *
 * Deletion is a SOFT delete, and the guard treats a soft-deleted role as
 * no session at all — see StaffJwtGuard.
 */
@Injectable()
export class StaffRbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** The catalogue, for the screen that ticks the boxes. */
  catalogue(): {
    readonly groups: readonly PermissionGroup[];
    readonly permissions: readonly CatalogueEntry[];
  } {
    return {
      groups: PERMISSION_GROUPS,
      permissions: PERMISSIONS.map((p) => ({
        key: p.key,
        label: p.label,
        description: p.description,
        group: p.group,
        dangerous: 'dangerous' in p && p.dangerous === true,
      })),
    };
  }

  async list(): Promise<readonly RoleView[]> {
    const rows = await this.prisma.client.staffRoleDefinition.findMany({
      where: { deletedAt: null },
      orderBy: [{ isSuperAdmin: 'desc' }, { isSystem: 'desc' }, { name: 'asc' }],
      include: {
        permissions: { select: { permission: true } },
        _count: { select: { staff: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      isSuperAdmin: r.isSuperAdmin,
      permissions: r.isSuperAdmin ? ALL_PERMISSION_KEYS : r.permissions.map((p) => p.permission),
      staffCount: r._count.staff,
    }));
  }

  async create(
    input: {
      readonly name: string;
      readonly description?: string;
      readonly permissions: readonly string[];
    },
    staffId: string,
  ): Promise<RoleView> {
    const name = input.name.trim();
    if (name.length < 2) {
      throw new BadRequestException({
        code: 'ROLE_NAME_TOO_SHORT',
        message: 'Give the role a name.',
      });
    }
    const permissions = this.validatePermissions(input.permissions);
    const key = await this.uniqueKey(name);

    const created = await this.prisma.client.$transaction(async (tx) => {
      const role = await tx.staffRoleDefinition.create({
        data: {
          key,
          name,
          description: input.description?.trim() ?? null,
          permissions: { create: permissions.map((permission) => ({ permission })) },
        },
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'staff.role.created',
          entityType: 'staff_role',
          entityId: role.id,
          metadata: { key, name, permissions },
          severity: 'HIGH',
        },
        tx,
      );
      return role;
    });

    return {
      id: created.id,
      key: created.key,
      name: created.name,
      description: created.description,
      isSystem: false,
      isSuperAdmin: false,
      permissions,
      staffCount: 0,
    };
  }

  async update(
    id: string,
    input: {
      readonly name?: string;
      readonly description?: string;
      readonly permissions?: readonly string[];
    },
    staffId: string,
  ): Promise<RoleView> {
    const role = await this.load(id);

    // The way back in from any mistake made on this screen.
    if (role.isSuperAdmin) {
      throw new ConflictException({
        code: 'SUPER_ADMIN_ROLE_IMMUTABLE',
        message:
          'The super admin role cannot be edited. It is what lets you undo a mistake made here.',
      });
    }

    const permissions =
      input.permissions === undefined ? undefined : this.validatePermissions(input.permissions);

    if (permissions !== undefined) await this.assertRbacSurvives(id, permissions);

    const before = role.permissions.map((p) => p.permission);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.staffRoleDefinition.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        },
      });
      if (permissions !== undefined) {
        // Replace wholesale rather than diff: the screen sends the full
        // intended set, and a diff that drifts grants something nobody
        // ticked.
        await tx.staffRolePermission.deleteMany({ where: { roleId: id } });
        await tx.staffRolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: id, permission })),
        });
      }
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'staff.role.updated',
          entityType: 'staff_role',
          entityId: id,
          changes: {
            name: { from: role.name, to: input.name ?? role.name },
            permissions: { from: before, to: permissions ?? before },
          },
          severity: 'HIGH',
        },
        tx,
      );
    });

    const fresh = await this.list();
    const view = fresh.find((r) => r.id === id);
    if (view === undefined)
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Gone.' });
    return view;
  }

  async remove(id: string, staffId: string): Promise<{ readonly deleted: true }> {
    const role = await this.load(id);

    if (role.isSuperAdmin) {
      throw new ConflictException({
        code: 'SUPER_ADMIN_ROLE_IMMUTABLE',
        message: 'The super admin role cannot be deleted.',
      });
    }
    if (role.isSystem) {
      throw new ConflictException({
        code: 'SYSTEM_ROLE_UNDELETABLE',
        message: `${role.name} is a built-in role. You can change what it may do, but not remove it.`,
      });
    }

    // Read the count inside the same transaction as the delete, so an
    // assignment landing between the check and the write cannot leave
    // somebody holding a deleted role.
    return this.prisma.client.$transaction(async (tx) => {
      const holders = await tx.staffUser.count({ where: { roleId: id, deletedAt: null } });
      if (holders > 0) {
        throw new ConflictException({
          code: 'ROLE_IN_USE',
          message: `${holders} staff member${holders === 1 ? '' : 's'} still hold ${role.name}. Move them to another role first.`,
        });
      }
      await this.assertRbacSurvives(id, []);

      await tx.staffRoleDefinition.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'staff.role.deleted',
          entityType: 'staff_role',
          entityId: id,
          metadata: { key: role.key, name: role.name },
          severity: 'HIGH',
        },
        tx,
      );
      return { deleted: true as const };
    });
  }

  private async load(id: string): Promise<{
    readonly id: string;
    readonly key: string;
    readonly name: string;
    readonly isSystem: boolean;
    readonly isSuperAdmin: boolean;
    readonly permissions: readonly { readonly permission: string }[];
  }> {
    const role = await this.prisma.client.staffRoleDefinition.findFirst({
      where: { id, deletedAt: null },
      include: { permissions: { select: { permission: true } } },
    });
    if (role === null) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'No such role.' });
    }
    return role;
  }

  private validatePermissions(keys: readonly string[]): readonly string[] {
    const unique = [...new Set(keys.map((k) => k.trim()).filter((k) => k !== ''))];
    const unknown = unique.filter((k) => !isPermissionKey(k));
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'UNKNOWN_PERMISSION',
        message: `Not a permission this system defines: ${unknown.join(', ')}`,
      });
    }
    return unique;
  }

  /**
   * Somebody must always be able to administer roles.
   *
   * Without this, one untick on the last role holding `rbac.manage`
   * leaves a console nobody can change — and the only way back would be
   * a database edit by hand. The super-admin role holds everything
   * implicitly, so it counts.
   */
  private async assertRbacSurvives(
    roleId: string,
    nextPermissions: readonly string[],
  ): Promise<void> {
    if (nextPermissions.includes('rbac.manage')) return;

    const others = await this.prisma.client.staffRoleDefinition.count({
      where: {
        deletedAt: null,
        id: { not: roleId },
        staff: { some: { deletedAt: null } },
        OR: [{ isSuperAdmin: true }, { permissions: { some: { permission: 'rbac.manage' } } }],
      },
    });
    if (others === 0) {
      throw new ConflictException({
        code: 'LAST_RBAC_MANAGER',
        message:
          'This is the last role anybody holds that can manage roles. Removing it would leave nobody able to change permissions, including this screen.',
      });
    }
  }

  /** `Warehouse manager` → `warehouse_manager`, and `_2` if that is taken. */
  private async uniqueKey(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'role';
    for (let n = 0; n < 50; n += 1) {
      const candidate = n === 0 ? base : `${base}_${n + 1}`;
      const clash = await this.prisma.client.staffRoleDefinition.findUnique({
        where: { key: candidate },
        select: { id: true },
      });
      if (clash === null) return candidate;
    }
    throw new ConflictException({
      code: 'ROLE_KEY_EXHAUSTED',
      message: 'Too many roles with that name. Pick a different one.',
    });
  }
}
