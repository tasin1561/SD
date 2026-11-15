import { DelhiveryWhatsappService } from '../../src/modules/courier-portal/services/delhivery-whatsapp.service';
import { CourierWhatsappRequestService } from '../../src/modules/courier-whatsapp/services/courier-whatsapp-request.service';

/**
 * Setting OFF → no job and no browser. Insert-only: the second read of
 * the same window hands the SAME hashes to a skipDuplicates insert.
 */
function prismaFake(enabled: boolean, ship?: Record<string, unknown>) {
  const created: Array<Array<{ dedupeHash: string }>> = [];
  const client = {
    systemSetting: { findUnique: jest.fn(async () => ({ valueBoolean: enabled })) },
    shipment: { findUnique: jest.fn(async () => ship ?? null), findMany: jest.fn(async () => []) },
    courierWhatsappMessage: {
      createMany: jest.fn(async (a: { data: Array<{ dedupeHash: string }> }) => {
        created.push(a.data);
        return { count: a.data.length };
      }),
      count: jest.fn(async () => 2),
    },
    courierWhatsappCheck: { upsert: jest.fn(async () => undefined) },
  };
  return { prisma: { client } as never, client, created };
}

describe('setting OFF', () => {
  it('the worker reads nothing and opens no browser', async () => {
    const { prisma, client } = prismaFake(false);
    const session = { page: jest.fn() };
    const svc = new DelhiveryWhatsappService(prisma, session as never);
    expect(await svc.fetchOne('s1')).toBe('DISABLED');
    expect(await svc.sweep()).toEqual({ picked: 0, outcomes: {} });
    expect(session.page).not.toHaveBeenCalled();
    expect(client.shipment.findMany).not.toHaveBeenCalled();
  });

  it('the API enqueues no job', async () => {
    const { prisma } = prismaFake(false);
    const svc = new CourierWhatsappRequestService(prisma, { createConnection: jest.fn() } as never);
    expect(await svc.request('s1')).toEqual({ queued: false, reason: 'DISABLED' });
  });

  it('a non-Delhivery parcel is never queued', async () => {
    const { prisma } = prismaFake(true, { courierCode: 'shiprocket', awbNumber: '1' });
    const svc = new CourierWhatsappRequestService(prisma, { createConnection: jest.fn() } as never);
    expect(await svc.request('s1')).toEqual({ queued: false, reason: 'NOT_DELHIVERY' });
  });
});

describe('insert-only', () => {
  it('two reads of the same window send identical hashes to a skipDuplicates insert', async () => {
    const { prisma, client, created } = prismaFake(true, {
      id: 's1',
      courierCode: 'delhivery',
      awbNumber: '999',
      courierAccountId: null,
    });
    const text = 'Whatsapp\nHello\n10:00 AM\nBye\n11:00 AM\nOkay';
    const modal = { innerText: async () => text };
    const yes = async (): Promise<void> => undefined;
    const node: Record<string, unknown> = {
      first: () => node,
      or: () => node,
      waitFor: yes,
      click: yes,
      innerText: async () => (modal ? text : ''),
      getByRole: () => node,
    };
    const page = {
      goto: yes,
      close: yes,
      url: () => '',
      keyboard: { press: yes },
      getByText: () => node,
      getByPlaceholder: () => node,
      getByRole: () => node,
    };
    const svc = new DelhiveryWhatsappService(prisma, { page: async () => page } as never);
    expect(await svc.fetchOne('s1')).toBe('OK');
    expect(await svc.fetchOne('s1')).toBe('OK');
    expect(created[0]?.map((r) => r.dedupeHash)).toEqual(created[1]?.map((r) => r.dedupeHash));
    expect(client.courierWhatsappMessage.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });
});
