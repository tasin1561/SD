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
  ALL_SELLER_PERMISSION_KEYS,
  SELLER_PERMISSIONS,
  SELLER_PERMISSION_GROUPS,
  isSellerPermissionKey,
  type SellerPermissionGroup,
} from '../../../common/auth/seller-permissions';

export interface SellerRoleView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly isOwner: boolean;
  readonly permissions: readonly string[];
  readonly memberCount: number;
}

export interface SellerCatalogueEntry {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly group: SellerPermissionGroup;
  readonly sensitive: boolean;
}

/**
 * A company's own roles.
 *
 * ── EVERY QUERY IS SCOPED BY sellerId, AND THAT IS THE POINT ─────────
 * These rows belong to a company. A lookup by role id ALONE would let
 * one seller edit or delete another's role just by knowing its id — and
 * ids appear in that company's own API responses, so "they would have
 * to guess it" is not a defence. Every method takes the seller id from
 * the authenticated session and every `where` carries it, so another
 * company's role is NOT FOUND rather than forbidden: a seller should not
 * learn that it exists.
 *
 * ── THE REFUSALS ─────────────────────────────────────────────────────
 *  - The owner role cannot be edited or deleted. It is the way back from
 *    any mistake made on this screen, and no support desk can undo a
 *    company locking itself out of its own account.
 *  - A default role cannot be deleted — removing the role the whole team
 *    holds is not an edit anyone means to make. Its permissions stay
 *    editable.
 *  - A role anybody holds cannot be deleted. Silently reassigning them
 *    is how somebody ends up with access nobody granted.
 *  - `roles.manage` cannot be taken off the last role in THIS company
 *    that has it: the one careless untick that saws the branch.
 */
@Injectable()
export class SellerRbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  catalogue(): {
    readonly groups: readonly SellerPermissionGroup[];
    readonly permissions: readonly SellerCatalogueEntry[];
  } {
    return {
      groups: SELLER_PERMISSION_GROUPS,
      permissions: SELLER_PERMISSIONS.map((p) => ({
        key: p.key,
        label: p.label,
        description: p.description,
        group: p.group,
        sensitive: 'sensitive' in p && p.sensitive === true,
      })),
    };
  }

  async list(sellerId: string): Promise<readonly SellerRoleView[]> {
    const rows = await this.prisma.client.sellerRoleDefinition.findMany({
      where: { sellerId, deletedAt: null },
      orderBy: [{ isOwner: 'desc' }, { isSystem: 'desc' }, { name: 'asc' }],
      include: {
        permissions: { select: { permission: true } },
        _count: { select: { users: { where: { deletedAt: null } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      isOwner: r.isOwner,
      permissions: r.isOwner ? ALL_SELLER_PERMISSION_KEYS : r.permissions.map((p) => p.permission),
      memberCount: r._count.users,
    }));
  }

  async create(
    sellerId: string,
    input: {
      readonly name: string;
      readonly description?: string;
      readonly permissions: readonly string[];
    },
    actorUserId: string,
  ): Promise<SellerRoleView> {
    const name = input.name.trim();
    if (name.length < 2) {
      throw new BadRequestException({
        code: 'ROLE_NAME_TOO_SHORT',
        message: 'Give the role a name.',
      });
    }
    const permissions = this.validate(input.permissions);
    const key = await this.uniqueKey(sellerId, name);

    const created = await this.prisma.client.$transaction(async (tx) => {
      const role = await tx.sellerRoleDefinition.create({
        data: {
          sellerId,
          key,
          name,
          description: input.description?.trim() ?? null,
          permissions: { create: permissions.map((permission) => ({ permission })) },
        },
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          actorId: actorUserId,
          action: 'seller.role.created',
          entityType: 'seller_role',
          entityId: role.id,
          metadata: { key, name, permissions },
          severity: 'MEDIUM',
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
      isOwner: false,
      permissions,
      memberCount: 0,
    };
  }

  async update(
    sellerId: string,
    id: string,
    input: {
      readonly name?: string;
      readonly description?: string;
      readonly permissions?: readonly string[];
    },
    actorUserId: string,
  ): Promise<SellerRoleView> {
    const role = await this.load(sellerId, id);
    if (role.isOwner) {
      throw new ConflictException({
        code: 'OWNER_ROLE_IMMUTABLE',
        message:
          'The owner role cannot be edited. It is what lets you undo a mistake made on this screen.',
      });
    }

    const permissions =
      input.permissions === undefined ? undefined : this.validate(input.permissions);
    if (permissions !== undefined) await this.assertRolesManageSurvives(sellerId, id, permissions);

    const before = role.permissions.map((p) => p.permission);

    await this.prisma.client.$transaction(async (tx) => {
      // Guarded on sellerId as well as id. Defence that depends on an
      // earlier read having scoped correctly is not defence.
      await tx.sellerRoleDefinition.updateMany({
        where: { id, sellerId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        },
      });
      if (permissions !== undefined) {
        // Replace wholesale rather than diff: the screen sends the full
        // intended set, and a diff that drifts grants something nobody
        // ticked.
        await tx.sellerRolePermission.deleteMany({ where: { roleId: id } });
        await tx.sellerRolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: id, permission })),
        });
      }
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          actorId: actorUserId,
          action: 'seller.role.updated',
          entityType: 'seller_role',
          entityId: id,
          changes: {
            name: { from: role.name, to: input.name ?? role.name },
            permissions: { from: before, to: permissions ?? before },
          },
          severity: 'MEDIUM',
        },
        tx,
      );
    });

    const fresh = (await this.list(sellerId)).find((r) => r.id === id);
    if (fresh === undefined) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Gone.' });
    }
    return fresh;
  }

  async remove(
    sellerId: string,
    id: string,
    actorUserId: string,
  ): Promise<{ readonly deleted: true }> {
    const role = await this.load(sellerId, id);
    if (role.isOwner) {
      throw new ConflictException({
        code: 'OWNER_ROLE_IMMUTABLE',
        message: 'The owner role cannot be deleted.',
      });
    }
    if (role.isSystem) {
      throw new ConflictException({
        code: 'SYSTEM_ROLE_UNDELETABLE',
        message: `${role.name} is one of the roles every account starts with. You can change what it covers, but not remove it.`,
      });
    }

    return this.prisma.client.$transaction(async (tx) => {
      // Counted INSIDE the deleting transaction: somebody assigned
      // between a check and a write would be left holding a role that no
      // longer exists.
      const holders = await tx.sellerUser.count({ where: { roleId: id, deletedAt: null } });
      if (holders > 0) {
        throw new ConflictException({
          code: 'ROLE_IN_USE',
          message: `${holders} ${holders === 1 ? 'person' : 'people'} still hold ${role.name}. Move them to another role first.`,
        });
      }
      await this.assertRolesManageSurvives(sellerId, id, []);

      await tx.sellerRoleDefinition.updateMany({
        where: { id, sellerId },
        data: { deletedAt: new Date() },
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          actorId: actorUserId,
          action: 'seller.role.deleted',
          entityType: 'seller_role',
          entityId: id,
          metadata: { key: role.key, name: role.name },
          severity: 'MEDIUM',
        },
        tx,
      );
      return { deleted: true as const };
    });
  }

  private async load(
    sellerId: string,
    id: string,
  ): Promise<{
    readonly id: string;
    readonly key: string;
    readonly name: string;
    readonly isSystem: boolean;
    readonly isOwner: boolean;
    readonly permissions: readonly { readonly permission: string }[];
  }> {
    const role = await this.prisma.client.sellerRoleDefinition.findFirst({
      where: { id, sellerId, deletedAt: null },
      include: { permissions: { select: { permission: true } } },
    });
    if (role === null) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'No such role.' });
    }
    return role;
  }

  private validate(keys: readonly string[]): readonly string[] {
    const unique = [...new Set(keys.map((k) => k.trim()).filter((k) => k !== ''))];
    const unknown = unique.filter((k) => !isSellerPermissionKey(k));
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'UNKNOWN_PERMISSION',
        message: `Not a permission this system defines: ${unknown.join(', ')}`,
      });
    }
    return unique;
  }

  /**
   * Somebody in THIS company must always be able to administer roles.
   *
   * Scoped by seller — another company having an owner is no help at all
   * to this one. The owner role holds everything implicitly, so it
   * counts.
   */
  private async assertRolesManageSurvives(
    sellerId: string,
    roleId: string,
    next: readonly string[],
  ): Promise<void> {
    if (next.includes('roles.manage')) return;
    const others = await this.prisma.client.sellerRoleDefinition.count({
      where: {
        sellerId,
        deletedAt: null,
        id: { not: roleId },
        users: { some: { deletedAt: null } },
        OR: [{ isOwner: true }, { permissions: { some: { permission: 'roles.manage' } } }],
      },
    });
    if (others === 0) {
      throw new ConflictException({
        code: 'LAST_ROLE_MANAGER',
        message:
          'This is the last role anybody here holds that can manage roles. Removing it would leave nobody able to change permissions, including on this screen.',
      });
    }
  }

  /** `Warehouse clerk` → `warehouse_clerk`, unique WITHIN this company. */
  private async uniqueKey(sellerId: string, name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'role';
    for (let n = 0; n < 50; n += 1) {
      const candidate = n === 0 ? base : `${base}_${n + 1}`;
      const clash = await this.prisma.client.sellerRoleDefinition.findFirst({
        where: { sellerId, key: candidate },
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
