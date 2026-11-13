import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AssistantTicketPhotosService } from '../../src/modules/assistant/services/assistant-ticket-photos.service';
import { AssistantStatusService } from '../../src/modules/assistant/services/assistant-status.service';
import { FakeSpaces, scope, staffScope, storeScope } from '../helpers/assistant-fixtures';

const TICKET = '0191a000-0000-7000-8000-0000000000f1';

function rig(opts: { visible?: boolean } = {}) {
  const row = {
    id: 'att-1',
    conversationId: 'c1',
    messageId: 'm1',
    kind: 'IMAGE' as const,
    mediaType: 'image/jpeg',
    originalName: 'damaged box.jpg',
    bytes: 1234,
    pages: null,
    width: 10,
    height: 10,
    sha256: 'x',
    storageKey: 'assistant/att-1',
  };
  const store = { ticketAttachments: jest.fn(async () => [row]) };
  const notFound = new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'No such ticket' });
  const tickets = {
    getForSeller: jest.fn(async () => {
      if (opts.visible === false) throw notFound;
      return {};
    }),
    getForStore: jest.fn(async () => {
      if (opts.visible === false) throw notFound;
      return {};
    }),
  };
  const svc = new AssistantTicketPhotosService(
    store as never,
    tickets as never,
    new FakeSpaces() as never,
  );
  return { svc, store, tickets };
}

describe('a ticket’s photos', () => {
  it('lists signed, download-only links for a client who may view tickets', async () => {
    const { svc, tickets } = rig();
    const out = await svc.list(scope({ permissions: ['tickets.view'] }), TICKET);
    expect(tickets.getForSeller).toHaveBeenCalledWith(expect.any(String), TICKET);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.url).toContain('attachment');
    expect(out.items[0]).not.toHaveProperty('storageKey');
  });

  it('is a 403 without tickets.view, and reads nothing', async () => {
    const { svc, store, tickets } = rig();
    await expect(svc.list(scope({ permissions: ['orders.view'] }), TICKET)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(store.ticketAttachments).not.toHaveBeenCalled();
    expect(tickets.getForSeller).not.toHaveBeenCalled();
  });

  it('is the ticket query’s own 404 for a ticket that is not theirs, and lists nothing', async () => {
    const { svc, store } = rig({ visible: false });
    await expect(svc.list(scope({ permissions: ['tickets.view'] }), TICKET)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      svc.list(storeScope({ permissions: ['tickets.view'] }), TICKET),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(store.ticketAttachments).not.toHaveBeenCalled();
  });

  it('reads a store’s ticket as that store user, and staff by permission alone', async () => {
    const { svc, tickets } = rig();
    await svc.list(storeScope({ permissions: ['tickets.view'] }), TICKET);
    expect(tickets.getForStore).toHaveBeenCalledWith(
      expect.any(String),
      TICKET,
      expect.objectContaining({ orderScope: 'ALL' }),
    );
    const staff = await svc.list(staffScope({ permissions: ['tickets.view'] }), TICKET);
    expect(staff.items).toHaveLength(1);
    await expect(svc.list(staffScope(), TICKET)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('the assistant status', () => {
  const budget = (enabled: boolean, portal: boolean) =>
    ({ enabled: async () => enabled, portalEnabled: async () => portal }) as never;

  it('is on only when the kill switch AND the console switch are on', async () => {
    const s = scope();
    expect((await new AssistantStatusService(budget(true, true)).status(s)).enabled).toBe(true);
    expect((await new AssistantStatusService(budget(false, true)).status(s)).enabled).toBe(false);
    expect((await new AssistantStatusService(budget(true, false)).status(s)).enabled).toBe(false);
  });

  it('hands over only the permissions the greeting card uses', async () => {
    const out = await new AssistantStatusService(budget(true, true)).status(
      scope({ permissions: ['orders.view', 'wallet.view', 'catalog.edit', 'staff.manage'] }),
    );
    expect(out.permissions).toEqual(['orders.view', 'wallet.view']);
  });
});
