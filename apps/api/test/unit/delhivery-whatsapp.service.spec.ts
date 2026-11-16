import { DelhiveryWhatsappService } from '../../src/modules/courier-portal/services/delhivery-whatsapp.service';
import { WhatsappLoggedOutError } from '../../src/modules/courier-portal/pages/delhivery-whatsapp.page';
import { CourierWhatsappRequestService } from '../../src/modules/courier-whatsapp/services/courier-whatsapp-request.service';

jest.mock('../../src/modules/courier-whatsapp/guards', () => ({
  ...jest.requireActual('../../src/modules/courier-whatsapp/guards'),
  availableMemoryMb: () => 4096,
}));
import {
  CLOSED,
  gate,
  onFailure,
  onSuccess,
  type BreakerState,
} from '../../src/modules/courier-whatsapp/breaker';
/** The real state machine over an in-memory state, shaped like the Redis store. */
function breaker() {
  let st: BreakerState = CLOSED;
  return {
    state: async () => st,
    gate: async () => gate(st, Date.now()),
    success: async () => {
      st = onSuccess();
    },
    failure: async (r: never, hard: boolean) => (st = onFailure(st, Date.now(), r, hard)),
    bump: async () => undefined,
  } as never;
}
const REQUESTS = { request: jest.fn(async () => ({ queued: true })) };

/**
 * Setting OFF → no job and no browser. Insert-only: the second read of
 * the same window hands the SAME hashes to a skipDuplicates insert.
 */
function prismaFake(enabled: boolean, ship?: Record<string, unknown>) {
  const created: Array<Array<{ dedupeHash: string }>> = [];
  const client = {
    systemSetting: {
      findUnique: jest.fn(async () => ({ valueBoolean: enabled, valueInt: 2 })),
    },
    shipment: { findUnique: jest.fn(async () => ship ?? null), findMany: jest.fn(async () => []) },
    courierWhatsappMessage: {
      createMany: jest.fn(async (a: { data: Array<{ dedupeHash: string }> }) => {
        created.push(a.data);
        return { count: a.data.length };
      }),
      count: jest.fn(async () => 2),
    },
    courierWhatsappCheck: { upsert: jest.fn(async () => undefined) },
    courierWhatsappRead: { create: jest.fn(async () => undefined), count: jest.fn(async () => 0) },
  };
  return { prisma: { client } as never, client, created };
}

describe('setting OFF', () => {
  it('the worker reads nothing and opens no browser', async () => {
    const { prisma, client } = prismaFake(false);
    const session = { page: jest.fn() };
    const svc = new DelhiveryWhatsappService(
      prisma,
      session as never,
      REQUESTS as never,
      breaker(),
    );
    expect((await svc.fetchOne('s1')).outcome).toBe('DISABLED');
    expect(await svc.sweep()).toEqual({ queued: 0 });
    expect(session.page).not.toHaveBeenCalled();
    expect(client.shipment.findMany).not.toHaveBeenCalled();
  });

  it('the API enqueues no job', async () => {
    const { prisma } = prismaFake(false);
    const svc = new CourierWhatsappRequestService(
      prisma,
      { createConnection: jest.fn() } as never,
      {} as never,
    );
    expect(await svc.request('s1')).toEqual({ queued: false, reason: 'DISABLED' });
  });

  it('a non-Delhivery parcel is never queued', async () => {
    const { prisma } = prismaFake(true, { courierCode: 'shiprocket', awbNumber: '1' });
    const svc = new CourierWhatsappRequestService(
      prisma,
      { createConnection: jest.fn() } as never,
      {} as never,
    );
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
      waitForTimeout: yes,
      close: yes,
      url: () => '',
      keyboard: { press: yes },
      getByText: () => node,
      getByPlaceholder: () => node,
      getByRole: () => node,
    };
    const svc = new DelhiveryWhatsappService(
      prisma,
      { page: async () => page, readerPage: async () => page } as never,
      REQUESTS as never,
      breaker(),
    );
    expect((await svc.fetchOne('s1')).outcome).toBe('OK');
    expect((await svc.fetchOne('s1')).outcome).toBe('OK');
    expect(created[0]?.map((r) => r.dedupeHash)).toEqual(created[1]?.map((r) => r.dedupeHash));
    expect(client.courierWhatsappMessage.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });
});

describe('logged out', () => {
  it('stops the batch: records LOGGED_OUT and does not read again until the pause ends', async () => {
    const { prisma, client } = prismaFake(true, {
      id: 's1',
      courierCode: 'delhivery',
      awbNumber: '999',
      courierAccountId: null,
    });
    const page = {
      close: async (): Promise<void> => undefined,
      goto: async () => undefined,
      waitForTimeout: async () => undefined,
      url: () => 'https://one.delhivery.com/v2/login',
    };
    const session = { page: jest.fn(async () => page), readerPage: jest.fn(async () => page) };
    const svc = new DelhiveryWhatsappService(
      prisma,
      session as never,
      REQUESTS as never,
      breaker(),
    );
    expect((await svc.fetchOne('s1')).outcome).toBe('LOGGED_OUT');
    expect((await svc.fetchOne('s1')).outcome).toBe('BREAKER_OPEN');
    expect(client.courierWhatsappRead.create).toHaveBeenCalledTimes(1);
    expect(session.page).toHaveBeenCalledTimes(1); // one sign-in, never a loop
    expect(new WhatsappLoggedOutError().name).toBe('WhatsappLoggedOutError');
  });

  it('master switch OFF opens nothing (portalMode is not consulted: a read)', async () => {
    const { prisma } = prismaFake(false);
    const session = { page: jest.fn(), readerPage: jest.fn() };
    const svc = new DelhiveryWhatsappService(
      prisma,
      session as never,
      REQUESTS as never,
      breaker(),
    );
    expect((await svc.fetchOne('s1')).outcome).toBe('DISABLED');
    expect(session.page).not.toHaveBeenCalled();
    expect(session.readerPage).not.toHaveBeenCalled();
  });
});
