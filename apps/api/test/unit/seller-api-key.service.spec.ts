import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SellerApiKeyService } from '../../src/modules/seller-api-key/seller-api-key.service';
import { TokenHashService } from '../../src/modules/auth-common/services/token-hash.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

interface KeyRow {
  id: string;
  sellerId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

function buildClient() {
  const rows: KeyRow[] = [];
  let seq = 0;
  const auditCalls: { data: Record<string, unknown> }[] = [];

  const client = {
    sellerApiKey: {
      create: jest.fn(
        async ({
          data,
        }: {
          data: Omit<KeyRow, 'id' | 'lastUsedAt' | 'revokedAt' | 'deletedAt' | 'createdAt'>;
        }) => {
          seq += 1;
          const row: KeyRow = {
            ...data,
            id: `key-${seq}`,
            lastUsedAt: null,
            revokedAt: null,
            deletedAt: null,
            createdAt: new Date(),
            expiresAt: data.expiresAt ?? null,
          };
          rows.push(row);
          return {
            id: row.id,
            name: row.name,
            keyPrefix: row.keyPrefix,
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
          };
        },
      ),
      findMany: jest.fn(async ({ where }: { where: { sellerId: string; deletedAt: null } }) =>
        rows
          .filter((r) => r.sellerId === where.sellerId && r.deletedAt === null)
          .map((r) => ({
            id: r.id,
            name: r.name,
            keyPrefix: r.keyPrefix,
            lastUsedAt: r.lastUsedAt,
            createdAt: r.createdAt,
            expiresAt: r.expiresAt,
            revokedAt: r.revokedAt,
          })),
      ),
      findFirst: jest.fn(
        async ({ where }: { where: { id: string; sellerId: string; deletedAt: null } }) =>
          rows.find(
            (r) => r.id === where.id && r.sellerId === where.sellerId && r.deletedAt === null,
          ) ?? null,
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<KeyRow> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      }),
    },
    auditLog: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        auditCalls.push(args);
        return { id: `a-${auditCalls.length}` };
      }),
    },
  };
  return { client, rows, auditCalls };
}

function makeSut() {
  const fixt = buildClient();
  const prisma = { client: fixt.client } as unknown as PrismaService;
  const hashes = new TokenHashService();
  const audit = new AuditLogService(prisma);
  const svc = new SellerApiKeyService(prisma, hashes, audit);
  return { svc, fixt, hashes };
}

const ctx = { ipAddress: '1.2.3.4', userAgent: 'jest', requestId: 'req-1' };

describe('SellerApiKeyService', () => {
  it('create: returns plaintext ONCE; stores prefix + hash; never persists plaintext', async () => {
    const { svc, fixt, hashes } = makeSut();
    const result = await svc.create('seller-1', { name: 'Prod' }, ctx);

    expect(result.plaintext.startsWith('skd_')).toBe(true);
    expect(result.plaintext.length).toBe(36);
    expect(result.keyPrefix.length).toBe(12);
    expect(result.plaintext.startsWith(result.keyPrefix)).toBe(true);

    const stored = fixt.rows[0]!;
    expect(stored.keyHash).toBe(hashes.sha256Hex(result.plaintext));
    expect(stored.keyPrefix).toBe(result.keyPrefix);
    // Plaintext is NOT in the stored row.
    expect(JSON.stringify(stored)).not.toContain(result.plaintext);

    expect(fixt.auditCalls[0]!.data['action']).toBe('seller.api_key.created');
  });

  it('create: respects expiresInDays', async () => {
    const { svc, fixt } = makeSut();
    await svc.create('seller-1', { name: 'short-lived', expiresInDays: 7 }, ctx);
    const exp = fixt.rows[0]!.expiresAt!;
    const days = (exp.getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('list: returns only the caller’s keys, never the hash, sorted newest-first', async () => {
    const { svc } = makeSut();
    await svc.create('seller-1', { name: 'A' }, ctx);
    await svc.create('seller-1', { name: 'B' }, ctx);
    await svc.create('seller-OTHER', { name: 'X' }, ctx);

    const rows = await svc.list('seller-1');
    expect(rows.map((r) => r.name).sort()).toEqual(['A', 'B']);
    for (const r of rows) {
      expect(r).not.toHaveProperty('keyHash');
      expect(r).not.toHaveProperty('plaintext');
    }
  });

  it('revoke: sets revokedAt + audits', async () => {
    const { svc, fixt } = makeSut();
    const created = await svc.create('seller-1', { name: 'K' }, ctx);
    await svc.revoke('seller-1', created.id, ctx);

    expect(fixt.rows[0]!.revokedAt).toBeInstanceOf(Date);
    const revokeAudit = fixt.auditCalls.find((c) => c.data['action'] === 'seller.api_key.revoked');
    expect(revokeAudit).toBeDefined();
  });

  it('revoke: 404 for missing or cross-seller id', async () => {
    const { svc } = makeSut();
    const created = await svc.create('seller-1', { name: 'K' }, ctx);
    await expect(svc.revoke('seller-OTHER', created.id, ctx)).rejects.toThrow(NotFoundException);
    await expect(svc.revoke('seller-1', 'missing', ctx)).rejects.toThrow(NotFoundException);
  });

  it('revoke: re-revoking → 400 ALREADY_REVOKED', async () => {
    const { svc } = makeSut();
    const created = await svc.create('seller-1', { name: 'K' }, ctx);
    await svc.revoke('seller-1', created.id, ctx);
    await expect(svc.revoke('seller-1', created.id, ctx)).rejects.toThrow(BadRequestException);
  });
});
