import { ForbiddenException } from '@nestjs/common';
import { Prisma, SellerCapability } from '@skydrop/db';
import {
  IN_FLIGHT_CAPABILITIES,
  SellerRestrictionService,
} from '../../src/modules/seller-restriction/services/seller-restriction.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';

type AnyArgs = Record<string, unknown>;
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

function makeSut(
  opts: {
    active?: AnyArgs | null;
    balance?: string;
    liftCount?: number;
  } = {},
) {
  const findFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.active === undefined
      ? {
          id: 'r-1',
          blockedCapabilities: [SellerCapability.ORDER_CREATE],
          clearAtBalanceInr: D('0'),
          reason: 'Balance went negative after three RTOs in one week.',
          createdAt: new Date('2026-08-24T00:00:00.000Z'),
        }
      : opts.active,
  );
  const create = jest.fn(async () => ({ id: 'r-new' }));
  const updateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(async () => ({
    count: opts.liftCount ?? 1,
  }));
  const client = {
    sellerRestriction: { findFirst, create, updateMany },
  };
  const prisma = { client } as unknown as PrismaService;
  const auditLog = jest.fn<Promise<string>, [AnyArgs]>(async () => 'a1');
  const audit = { log: auditLog } as unknown as AuditLogService;
  const balanceCached = jest.fn(async () => D(opts.balance ?? '-3000'));
  const wallet = { balanceCached } as unknown as WalletService;
  return {
    svc: new SellerRestrictionService(prisma, audit, wallet),
    findFirst,
    create,
    updateMany,
    auditLog,
  };
}

describe('SellerRestrictionService.assertAllowed', () => {
  it('lets everything through when there is no hold', async () => {
    const { svc } = makeSut({ active: null });
    await expect(svc.assertAllowed('s-1', SellerCapability.ORDER_CREATE)).resolves.toBeUndefined();
  });

  it('blocks only the chosen capabilities — a hold is not a suspension', async () => {
    // The point of picking per seller is that what one owes for is not
    // what another does. A hold on new orders must not stop them
    // reaching their wallet to pay.
    const { svc } = makeSut();
    await expect(svc.assertAllowed('s-1', SellerCapability.ORDER_CREATE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      svc.assertAllowed('s-1', SellerCapability.CONSIGNMENT_CREATE),
    ).resolves.toBeUndefined();
  });

  it('the refusal carries the shortfall, because the message is the FIX', async () => {
    // A blocked action that only says "forbidden" is how you lose a
    // seller who would have paid.
    const { svc } = makeSut({
      active: {
        id: 'r-1',
        blockedCapabilities: [SellerCapability.ORDER_CREATE],
        clearAtBalanceInr: D('500'),
        reason: 'Balance went negative.',
        createdAt: new Date(),
      },
      balance: '-3000',
    });
    await expect(svc.assertAllowed('s-1', SellerCapability.ORDER_CREATE)).rejects.toMatchObject({
      response: {
        code: 'SELLER_RESTRICTED',
        cause: { shortfallInr: '3500.00', clearAtBalanceInr: '500.00' },
      },
    });
  });

  it('LIFTS ITSELF once the balance reaches the threshold', async () => {
    // Applied by a person, cleared by money. Making a seller wait for
    // someone to notice their payment is how a solvent account stays
    // frozen over a weekend.
    const { svc, updateMany } = makeSut({ balance: '250' });
    await expect(svc.assertAllowed('s-1', SellerCapability.ORDER_CREATE)).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledTimes(1);
    const call = updateMany.mock.calls[0]?.[0] as unknown as { where: AnyArgs };
    // Guarded, never read-then-write: two requests can arrive together
    // the moment a top-up lands and both would see an active hold.
    expect(call.where).toMatchObject({ id: 'r-1', liftedAt: null });
  });
});

describe('SellerRestrictionService.apply', () => {
  const base = {
    sellerId: 's-1',
    capabilities: [SellerCapability.ORDER_CREATE],
    clearAtBalanceInr: '0',
    reason: 'Balance went negative after three RTOs in one week.',
    staffId: 'st-1',
  };

  it('refuses a reason the seller could not act on', async () => {
    const { svc } = makeSut({ active: null });
    await expect(svc.apply({ ...base, reason: 'owes' })).rejects.toMatchObject({
      response: { code: 'RESTRICTION_REASON_TOO_SHORT' },
    });
  });

  it('refuses a hold that blocks nothing', async () => {
    const { svc } = makeSut({ active: null });
    await expect(svc.apply({ ...base, capabilities: [] })).rejects.toMatchObject({
      response: { code: 'RESTRICTION_NOTHING_BLOCKED' },
    });
  });

  it('refuses a second hold while one is in force', async () => {
    // Two live rows would mean two answers to "is this blocked".
    const { svc } = makeSut();
    await expect(svc.apply(base)).rejects.toMatchObject({
      response: { code: 'RESTRICTION_ALREADY_ACTIVE' },
    });
  });

  it('audits HIGH and records whether moving work was touched', async () => {
    // A hold stops a seller trading; that is not a MEDIUM decision. The
    // in-flight flag is what makes an unusual choice findable later.
    const { svc, auditLog } = makeSut({ active: null });
    await svc.apply({ ...base, capabilities: [SellerCapability.SHIPMENT_DISPATCH] });
    const entry = auditLog.mock.calls[0]?.[0] as unknown as {
      severity: string;
      metadata: AnyArgs;
    };
    expect(entry.severity).toBe('HIGH');
    expect(entry.metadata).toMatchObject({ touchesInFlightWork: true });
  });
});

describe('the in-flight set', () => {
  it('names exactly the three that touch parcels already moving', () => {
    // Blocking these does not protect the money — the parcel still has
    // to be delivered, tracked and returned. They stay available, but
    // the admin screen has to be able to say what they cost, and it
    // reads that from here.
    expect([...IN_FLIGHT_CAPABILITIES].sort()).toEqual(
      [
        SellerCapability.RTO_RECEIVE,
        SellerCapability.SHIPMENT_DISPATCH,
        SellerCapability.TRACKING_VIEW,
      ].sort(),
    );
  });
});
