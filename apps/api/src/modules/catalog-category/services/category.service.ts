import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, PackageType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { CreateCategoryDto } from '../dto/create-category.dto';
import type { UpdateCategoryDto } from '../dto/update-category.dto';

export const FULL_PATH_SEPARATOR = ' > ';

export interface CategoryView {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  fullPath: string;
  depth: number;
  sortOrder: number;
  defaultPackageType: PackageType | null;
  requiresFragile: boolean;
  requiresColdChain: boolean;
  defaultHsCode: string | null;
  defaultGstRate: Prisma.Decimal | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryTreeNode extends CategoryView {
  children: CategoryTreeNode[];
}

const VIEW_SELECT = {
  id: true,
  parentId: true,
  slug: true,
  name: true,
  fullPath: true,
  depth: true,
  sortOrder: true,
  defaultPackageType: true,
  requiresFragile: true,
  requiresColdChain: true,
  defaultHsCode: true,
  defaultGstRate: true,
  createdAt: true,
  updatedAt: true,
} as const;

type TxClient = Prisma.TransactionClient;

@Injectable()
export class CategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // ---------- reads (shared with seller-facing controller) ----------

  async list(): Promise<CategoryView[]> {
    return this.prisma.client.category.findMany({
      where: { deletedAt: null },
      orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: VIEW_SELECT,
    });
  }

  async getTree(): Promise<CategoryTreeNode[]> {
    const flat = await this.list();
    const byParent = new Map<string | null, CategoryTreeNode[]>();
    for (const c of flat) {
      const node: CategoryTreeNode = { ...c, children: [] };
      const key = c.parentId;
      const bucket = byParent.get(key);
      if (bucket) bucket.push(node);
      else byParent.set(key, [node]);
    }
    const attach = (nodes: CategoryTreeNode[]): CategoryTreeNode[] => {
      for (const n of nodes) {
        n.children = byParent.get(n.id) ?? [];
        attach(n.children);
      }
      return nodes;
    };
    return attach(byParent.get(null) ?? []);
  }

  async getById(id: string): Promise<CategoryView> {
    const row = await this.prisma.client.category.findFirst({
      where: { id, deletedAt: null },
      select: VIEW_SELECT,
    });
    if (!row) {
      throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found' });
    }
    return row;
  }

  // ---------- admin mutations ----------

  async create(
    input: CreateCategoryDto,
    staffActorId: string,
    ctx: ClientContext,
  ): Promise<CategoryView> {
    const slugTaken = await this.prisma.client.category.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (slugTaken) {
      throw new ConflictException({
        code: 'SLUG_TAKEN',
        message: `Category slug "${input.slug}" is already in use`,
      });
    }

    let depth = 0;
    let fullPath = input.name;
    if (input.parentId) {
      const parent = await this.prisma.client.category.findFirst({
        where: { id: input.parentId, deletedAt: null },
        select: { id: true, depth: true, fullPath: true },
      });
      if (!parent) {
        throw new BadRequestException({
          code: 'PARENT_NOT_FOUND',
          message: 'Parent category not found',
        });
      }
      depth = parent.depth + 1;
      fullPath = `${parent.fullPath}${FULL_PATH_SEPARATOR}${input.name}`;
    }

    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.category.create({
        data: {
          parentId: input.parentId ?? null,
          slug: input.slug,
          name: input.name,
          fullPath,
          depth,
          sortOrder: input.sortOrder ?? 0,
          defaultPackageType: input.defaultPackageType ?? null,
          requiresFragile: input.requiresFragile ?? false,
          requiresColdChain: input.requiresColdChain ?? false,
          defaultHsCode: input.defaultHsCode ?? null,
          defaultGstRate:
            input.defaultGstRate === undefined
              ? null
              : new Prisma.Decimal(input.defaultGstRate),
        },
        select: VIEW_SELECT,
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffActorId,
          action: 'catalog.category.created',
          entityType: 'category',
          entityId: row.id,
          metadata: {
            slug: row.slug,
            parentId: row.parentId,
            fullPath: row.fullPath,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
      return row;
    });
  }

  async update(
    id: string,
    input: UpdateCategoryDto,
    staffActorId: string,
    ctx: ClientContext,
  ): Promise<CategoryView> {
    const existing = await this.prisma.client.category.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found' });
    }

    const data: Prisma.CategoryUpdateInput = {};
    const changes: Record<string, string | number | boolean | null> = {};
    if (input.name !== undefined) {
      data.name = input.name;
      changes['name'] = input.name;
    }
    if (input.sortOrder !== undefined) {
      data.sortOrder = input.sortOrder;
      changes['sortOrder'] = input.sortOrder;
    }
    if (input.defaultPackageType !== undefined) {
      data.defaultPackageType = input.defaultPackageType;
      changes['defaultPackageType'] = input.defaultPackageType;
    }
    if (input.requiresFragile !== undefined) {
      data.requiresFragile = input.requiresFragile;
      changes['requiresFragile'] = input.requiresFragile;
    }
    if (input.requiresColdChain !== undefined) {
      data.requiresColdChain = input.requiresColdChain;
      changes['requiresColdChain'] = input.requiresColdChain;
    }
    if (input.defaultHsCode !== undefined) {
      data.defaultHsCode = input.defaultHsCode;
      changes['defaultHsCode'] = input.defaultHsCode;
    }
    if (input.defaultGstRate !== undefined) {
      data.defaultGstRate =
        input.defaultGstRate === null ? null : new Prisma.Decimal(input.defaultGstRate);
      changes['defaultGstRate'] = input.defaultGstRate;
    }

    if (Object.keys(changes).length === 0) {
      return this.getById(id);
    }

    return this.prisma.client.$transaction(async (tx) => {
      await tx.category.update({ where: { id }, data });
      // A name change ripples into this node's fullPath and every
      // descendant's fullPath.
      if (input.name !== undefined && input.name !== existing.name) {
        await this.recomputeSubtree(tx, id);
      }
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffActorId,
          action: 'catalog.category.updated',
          entityType: 'category',
          entityId: id,
          changes: changes as Prisma.InputJsonValue,
          metadata: {
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
      const fresh = await tx.category.findUniqueOrThrow({ where: { id }, select: VIEW_SELECT });
      return fresh;
    });
  }

  async move(
    id: string,
    newParentId: string | null,
    staffActorId: string,
    ctx: ClientContext,
  ): Promise<CategoryView> {
    const node = await this.prisma.client.category.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, parentId: true },
    });
    if (!node) {
      throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found' });
    }

    if (newParentId !== null) {
      if (newParentId === id) {
        throw new BadRequestException({
          code: 'INVALID_MOVE',
          message: 'A category cannot be its own parent',
        });
      }
      const newParent = await this.prisma.client.category.findFirst({
        where: { id: newParentId, deletedAt: null },
        select: { id: true },
      });
      if (!newParent) {
        throw new BadRequestException({
          code: 'PARENT_NOT_FOUND',
          message: 'Target parent category not found',
        });
      }
      // Cycle prevention: the new parent must not be the node itself or
      // any of its descendants.
      const descendantIds = await this.collectDescendantIds(id);
      if (descendantIds.has(newParentId)) {
        throw new BadRequestException({
          code: 'INVALID_MOVE',
          message: 'Cannot move a category under one of its own descendants',
        });
      }
    }

    return this.prisma.client.$transaction(async (tx) => {
      await tx.category.update({ where: { id }, data: { parentId: newParentId } });
      await this.recomputeSubtree(tx, id);
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffActorId,
          action: 'catalog.category.moved',
          entityType: 'category',
          entityId: id,
          changes: { parentId: { from: node.parentId, to: newParentId } },
          metadata: {
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
      return tx.category.findUniqueOrThrow({ where: { id }, select: VIEW_SELECT });
    });
  }

  async softDelete(id: string, staffActorId: string, ctx: ClientContext): Promise<void> {
    const node = await this.prisma.client.category.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, slug: true },
    });
    if (!node) {
      throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found' });
    }

    const [childCount, productCount] = await Promise.all([
      this.prisma.client.category.count({ where: { parentId: id, deletedAt: null } }),
      this.prisma.client.product.count({ where: { categoryId: id, deletedAt: null } }),
    ]);
    if (childCount > 0) {
      throw new ConflictException({
        code: 'CATEGORY_HAS_CHILDREN',
        message: 'Cannot delete a category that has subcategories; move or delete them first',
      });
    }
    if (productCount > 0) {
      throw new ConflictException({
        code: 'CATEGORY_HAS_PRODUCTS',
        message: 'Cannot delete a category that still has products assigned',
      });
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.category.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffActorId,
          action: 'catalog.category.deleted',
          entityType: 'category',
          entityId: id,
          metadata: {
            slug: node.slug,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
    });
  }

  // ---------- internal ----------

  /**
   * Recompute fullPath + depth for `rootId` and every descendant. Loads
   * the full (non-deleted) category set — the tree is admin-managed and
   * small in Phase 1A — builds an adjacency map, and BFS-updates each
   * affected node. Runs inside the caller's transaction.
   */
  private async recomputeSubtree(tx: TxClient, rootId: string): Promise<void> {
    const all = await tx.category.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true, name: true },
    });
    const byId = new Map(all.map((c) => [c.id, c]));
    const childrenByParent = new Map<string, string[]>();
    for (const c of all) {
      if (c.parentId) {
        const arr = childrenByParent.get(c.parentId);
        if (arr) arr.push(c.id);
        else childrenByParent.set(c.parentId, [c.id]);
      }
    }

    const root = byId.get(rootId);
    if (!root) return;

    // Resolve the root's own path/depth from its (already-updated) parent.
    let rootDepth = 0;
    let rootPath = root.name;
    if (root.parentId) {
      const parent = await tx.category.findUnique({
        where: { id: root.parentId },
        select: { depth: true, fullPath: true },
      });
      if (parent) {
        rootDepth = parent.depth + 1;
        rootPath = `${parent.fullPath}${FULL_PATH_SEPARATOR}${root.name}`;
      }
    }

    const queue: Array<{ id: string; depth: number; path: string }> = [
      { id: rootId, depth: rootDepth, path: rootPath },
    ];
    let cursor = 0;
    while (cursor < queue.length) {
      const cur = queue[cursor];
      cursor += 1;
      if (!cur) continue;
      await tx.category.update({
        where: { id: cur.id },
        data: { depth: cur.depth, fullPath: cur.path },
      });
      for (const childId of childrenByParent.get(cur.id) ?? []) {
        const child = byId.get(childId);
        if (!child) continue;
        queue.push({
          id: childId,
          depth: cur.depth + 1,
          path: `${cur.path}${FULL_PATH_SEPARATOR}${child.name}`,
        });
      }
    }
  }

  /**
   * Ordered ancestor chain, root-first, INCLUDING the category itself:
   * [rootId, ..., parentId, categoryId]. Used by attribute inheritance
   * resolution (apply root defs first so deeper categories override).
   * Throws if the category does not exist (or is deleted).
   */
  async getAncestorChainIds(categoryId: string): Promise<string[]> {
    const all = await this.prisma.client.category.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true },
    });
    const byId = new Map(all.map((c) => [c.id, c]));
    if (!byId.has(categoryId)) {
      throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: 'Category not found' });
    }
    const chain: string[] = [];
    let cursor: string | null = categoryId;
    const guard = new Set<string>();
    while (cursor) {
      if (guard.has(cursor)) break; // defensive: never loop on corrupt data
      guard.add(cursor);
      chain.push(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return chain.reverse();
  }

  /** Public wrapper — descendant ids (excludes the category itself). */
  async getDescendantIds(categoryId: string): Promise<string[]> {
    return [...(await this.collectDescendantIds(categoryId))];
  }

  private async collectDescendantIds(rootId: string): Promise<Set<string>> {
    const all = await this.prisma.client.category.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true },
    });
    const childrenByParent = new Map<string, string[]>();
    for (const c of all) {
      if (c.parentId) {
        const arr = childrenByParent.get(c.parentId);
        if (arr) arr.push(c.id);
        else childrenByParent.set(c.parentId, [c.id]);
      }
    }
    const out = new Set<string>();
    const queue = [...(childrenByParent.get(rootId) ?? [])];
    let cursor = 0;
    while (cursor < queue.length) {
      const cur = queue[cursor];
      cursor += 1;
      if (cur === undefined || out.has(cur)) continue;
      out.add(cur);
      queue.push(...(childrenByParent.get(cur) ?? []));
    }
    return out;
  }
}
