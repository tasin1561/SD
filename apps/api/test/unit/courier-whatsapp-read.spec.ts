import { NotFoundException } from '@nestjs/common';
import { CourierWhatsappReadService } from '../../src/modules/courier-whatsapp/services/courier-whatsapp-read.service';
import { StoreCourierWhatsappController } from '../../src/modules/courier-whatsapp/controllers/courier-whatsapp.controllers';

/** Scope: the tenant id goes INTO the order query, so a foreign order is a 404. */
describe('CourierWhatsappReadService scope', () => {
  function svc(orderRow: unknown) {
    const findFirst = jest.fn(async () => orderRow);
    const prisma = {
      client: {
        order: { findFirst },
        orderShipment: { findFirst: jest.fn(async () => null) },
        systemSetting: { findUnique: jest.fn(async () => ({ valueBoolean: true })) },
        shipment: {
          findUnique: jest.fn(async () => ({
            awbNumber: '1',
            courierWhatsappCheck: null,
            courierWhatsappMessages: [{ text: 'hi', sentLabel: '10:00 AM', sentAt: null }],
          })),
        },
      },
    };
    return {
      service: new CourierWhatsappReadService(
        prisma as never,
        { request: jest.fn() } as never,
        { state: async () => ({ status: 'closed' }) } as never,
      ),
      findFirst,
    };
  }

  it("a seller's id is part of the query; another seller's order is a 404", async () => {
    const { service, findFirst } = svc(null);
    await expect(service.forOrder('o1', { sellerId: 'seller-A' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'o1', sellerId: 'seller-A' }),
      }),
    );
  });

  it('staff scope adds no seller filter and returns the stored bubbles', async () => {
    const { service, findFirst } = svc({ orderShipments: [{ shipmentId: 's1' }] });
    const view = await service.forOrder('o1', { sellerId: null });
    expect(view.messages).toEqual([{ text: 'hi', sentLabel: '10:00 AM', sentAt: null }]);
    const where = (findFirst.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0]
      .where;
    expect('sellerId' in where).toBe(false);
  });

  it('store / associate: the store order read decides; its 404 stops the read', async () => {
    const read = { forProvenOrder: jest.fn() };
    const orders = { events: jest.fn().mockRejectedValue(new NotFoundException()) };
    const c = new StoreCourierWhatsappController(read as never, orders as never);
    const user = { storeId: 'st', orderScope: 'OWN', id: 'u' } as never;
    await expect(c.get(user, 'o1')).rejects.toBeInstanceOf(NotFoundException);
    expect(read.forProvenOrder).not.toHaveBeenCalled();
  });
});
