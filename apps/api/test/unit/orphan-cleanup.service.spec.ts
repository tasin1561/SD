import { OrphanCleanupService } from '../../src/modules/catalog-image/services/orphan-cleanup.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SpacesService } from '../../src/infrastructure/spaces/spaces.service';

const NOW = Date.UTC(2026, 4, 16, 12, 0, 0);
const OLD = new Date(NOW - 48 * 3600 * 1000); // 48h old
const FRESH = new Date(NOW - 1 * 3600 * 1000); // 1h old

function makeSut(opts: {
  objects: Array<{ key: string; lastModified: Date }>;
  registeredKeys: string[];
}) {
  const deleted: string[] = [];
  const spaces = {
    listObjects: jest.fn(async () => opts.objects),
    deleteObjects: jest.fn(async (keys: string[]) => {
      deleted.push(...keys);
    }),
  } as unknown as SpacesService;

  const auditCreate = jest.fn().mockResolvedValue({ id: 'a-1' });
  const prismaClient = {
    productImage: {
      findFirst: jest.fn(async (args: { where: { spacesKey: string } }) =>
        opts.registeredKeys.includes(args.where.spacesKey) ? { id: 'img-1' } : null,
      ),
    },
    auditLog: { create: auditCreate },
  };
  const prisma = { client: prismaClient } as unknown as PrismaService;
  const audit = new AuditLogService(prisma);
  const svc = new OrphanCleanupService(prisma, spaces, audit);
  return { svc, deleted, auditCreate, spaces };
}

const origKey = (s = 's1', v = 'v1', t = 'tok1', ext = 'jpg') =>
  `sellers/${s}/variants/${v}/${t}.${ext}`;
const thumbKey = (s = 's1', v = 'v1', t = 'tok1') =>
  `sellers/${s}/variants/${v}/thumbnails/${t}.webp`;

describe('OrphanCleanupService.sweep', () => {
  it('deletes an old, unregistered original and audits it', async () => {
    const key = origKey();
    const sut = makeSut({
      objects: [{ key, lastModified: OLD }],
      registeredKeys: [],
    });
    const res = await sut.svc.sweep(NOW);
    expect(res).toEqual({ scanned: 1, candidates: 1, deleted: 1 });
    expect(sut.deleted).toEqual([key]);
    const audit = sut.auditCreate.mock.calls.at(-1)?.[0].data;
    expect(audit.action).toBe('catalog.image.orphan_deleted');
    expect(audit.metadata.spacesKey).toBe(key);
  });

  it('skips an object that has a product_images row (registered)', async () => {
    const key = origKey();
    const sut = makeSut({
      objects: [{ key, lastModified: OLD }],
      registeredKeys: [key],
    });
    const res = await sut.svc.sweep(NOW);
    expect(res.deleted).toBe(0);
    expect(sut.deleted).toEqual([]);
  });

  it('skips objects younger than 24h (not yet a candidate)', async () => {
    const sut = makeSut({
      objects: [{ key: origKey(), lastModified: FRESH }],
      registeredKeys: [],
    });
    const res = await sut.svc.sweep(NOW);
    expect(res.candidates).toBe(0);
    expect(res.deleted).toBe(0);
  });

  it('skips thumbnail keys (derivatives) even when old + unregistered', async () => {
    const sut = makeSut({
      objects: [{ key: thumbKey(), lastModified: OLD }],
      registeredKeys: [],
    });
    const res = await sut.svc.sweep(NOW);
    expect(res.candidates).toBe(0);
    expect(res.deleted).toBe(0);
  });

  it('skips keys that do not match the canonical original layout', async () => {
    const sut = makeSut({
      objects: [{ key: 'sellers/s1/variants/v1/nested/extra/tok.jpg', lastModified: OLD }],
      registeredKeys: [],
    });
    const res = await sut.svc.sweep(NOW);
    expect(res.candidates).toBe(0);
    expect(res.deleted).toBe(0);
  });

  it('mixed batch: deletes only the true orphan', async () => {
    const orphan = origKey('s1', 'v1', 'orphan');
    const registered = origKey('s1', 'v1', 'kept');
    const fresh = origKey('s2', 'v2', 'fresh');
    const sut = makeSut({
      objects: [
        { key: orphan, lastModified: OLD },
        { key: registered, lastModified: OLD },
        { key: fresh, lastModified: FRESH },
        { key: thumbKey('s1', 'v1', 'orphan'), lastModified: OLD },
      ],
      registeredKeys: [registered],
    });
    const res = await sut.svc.sweep(NOW);
    expect(sut.deleted).toEqual([orphan]);
    expect(res.deleted).toBe(1);
  });
});
