import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import { ActorType } from '@skydrop/db';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * `audit_logs.entity_id` is `@db.Uuid`, and a non-UUID used to lose the
 * ENTIRE row.
 *
 * Postgres rejects the INSERT with P2023, `log()` swallows it by design
 * (an audit write has never been allowed to fail the operation that
 * scheduled it), and the action ends up with no trail at all — while
 * having succeeded. Found in production on 2026-09-09: switching the
 * Delhivery portal channel off recorded nothing, and the only evidence
 * was one ERROR line in the process log.
 *
 * Three call sites were passing a courier code or a warehouse name.
 * Those are fixed to the convention every other courier-scoped row
 * already follows — `entityId: null`, identifier in metadata — and this
 * is the backstop so the next one degrades instead of vanishing.
 */
function makeSut() {
  const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'row-1',
    ...args.data,
  }));
  const prisma = { client: { auditLog: { create } } } as unknown as PrismaService;
  return { svc: new AuditLogService(prisma), create };
}

const BASE = {
  actorType: ActorType.STAFF,
  action: 'courier.channel.portal_mode_changed',
  entityType: 'courier',
} as const;

describe('a non-UUID entityId keeps the audit row', () => {
  it('moves a courier code into metadata rather than losing the write', async () => {
    const { svc, create } = makeSut();

    await svc.log({ ...BASE, entityId: 'delhivery', metadata: { to: 'OFF' } });

    const data = create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(data['entityId']).toBeNull();
    expect(data['metadata']).toMatchObject({ entityRef: 'delhivery', to: 'OFF' });
  });

  it('keeps the row even when there was no metadata to merge into', async () => {
    const { svc, create } = makeSut();

    await svc.log({ ...BASE, entityId: 'a-warehouse-name' });

    const data = create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(data['entityId']).toBeNull();
    expect(data['metadata']).toMatchObject({ entityRef: 'a-warehouse-name' });
  });

  it('leaves a real UUID exactly where it belongs', async () => {
    // The column is what makes "everything about this order" answerable
    // without a JSON scan, so a genuine id must never be diverted.
    const { svc, create } = makeSut();
    const id = '01a07db5-5147-7fcf-8843-71883b6aef99';

    await svc.log({ ...BASE, entityType: 'order', entityId: id });

    const data = create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(data['entityId']).toBe(id);
    expect(data['metadata']).not.toMatchObject({ entityRef: expect.anything() });
  });

  it('a null entityId stays null and gains nothing', async () => {
    const { svc, create } = makeSut();

    await svc.log({ ...BASE, entityId: null, metadata: { courierCode: 'delhivery' } });

    const data = create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(data['entityId']).toBeNull();
    expect(data['metadata']).not.toMatchObject({ entityRef: expect.anything() });
  });
});
