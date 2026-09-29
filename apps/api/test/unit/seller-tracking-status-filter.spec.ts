import { BadRequestException } from '@nestjs/common';
import { ShipmentStatus } from '@skydrop/db';
import { SellerTrackingController } from '../../src/modules/seller-tracking/controllers/seller-tracking.controller';

/**
 * A BAD `?status=` MUST BE A 400 THAT NAMES THE VALUE, NOT A 500.
 *
 * `@Query('status') status?: ShipmentStatus` is a TYPE. A query string is
 * whatever the caller sent, so an unknown value went into a `where` on an
 * enum column and Prisma threw — which the filter turned into "API 500
 * (INTERNAL_ERROR): Internal server error" on the seller's own screen.
 *
 * And the seller's own screen was the caller: its filter tab sent
 * `DELIVERY_FAILED`, which is an ORDER status. The shipment enum's value
 * is `DELIVERY_ATTEMPTED`. So the one filter a seller comes to tracking
 * for crashed the page, and the tile counting the same non-existent value
 * read 0 for ever.
 *
 * The refusal names what was allowed, because the next person to make
 * this mistake will be reading the error rather than the enum.
 */
describe('seller tracking — the status filter', () => {
  const seller = { id: 'seller-1' } as never;
  const restrictions = { assertAllowed: () => Promise.resolve() } as never;

  function controller(seen: Array<Record<string, unknown>>): SellerTrackingController {
    return new SellerTrackingController(
      {
        list: (_id: string, query: Record<string, unknown>) => {
          seen.push(query);
          return Promise.resolve([]);
        },
      } as never,
      restrictions,
    );
  }

  it('refuses a value that is not a shipment status, by name', async () => {
    const seen: Array<Record<string, unknown>> = [];
    await expect(controller(seen).list(seller, 'DELIVERY_FAILED')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(seen).toHaveLength(0);
  });

  it('passes a real one through', async () => {
    const seen: Array<Record<string, unknown>> = [];
    await controller(seen).list(seller, ShipmentStatus.DELIVERY_ATTEMPTED);
    expect(seen[0]).toMatchObject({ status: 'DELIVERY_ATTEMPTED' });
  });

  it('asks for everything when none is given', async () => {
    const seen: Array<Record<string, unknown>> = [];
    await controller(seen).list(seller);
    expect(seen[0]).toEqual({});
  });
});
