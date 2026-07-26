import { NotFoundException } from '@nestjs/common';
import { CredentialEnvironment } from '@skydrop/db';
import { CourierAccountRoutingService } from '../../src/modules/courier-shared/services/courier-account-routing.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;
type Link = { courierAccountId: string; distributionWeight: number };

function makeService(opts: { links?: Link[]; defaultAccountId?: string | null } = {}) {
  const linkFindMany = jest.fn<Promise<Link[]>, [AnyArgs]>(
    async () => opts.links ?? [],
  );
  const accountFindFirst = jest.fn<Promise<{ id: string } | null>, [AnyArgs]>(async () =>
    opts.defaultAccountId === undefined
      ? { id: 'default-acct' }
      : opts.defaultAccountId === null
        ? null
        : { id: opts.defaultAccountId },
  );
  const client = {
    sellerCourierAccountLink: { findMany: linkFindMany },
    courierAccount: { findFirst: accountFindFirst },
  } as unknown as PrismaService['client'];
  const svc = new CourierAccountRoutingService({ client } as unknown as PrismaService);
  return { svc, linkFindMany, accountFindFirst };
}

describe('CourierAccountRoutingService.selectAccount', () => {
  const randomSpy = jest.spyOn(Math, 'random');
  afterAll(() => randomSpy.mockRestore());

  it('falls back to the DEFAULT account when the seller has no active link', async () => {
    const { svc, accountFindFirst } = makeService({ links: [] });
    const result = await svc.selectAccount('seller-1', 'courier-1', CredentialEnvironment.PRODUCTION);
    expect(result).toEqual({ courierAccountId: 'default-acct', source: 'DEFAULT_ACCOUNT' });
    expect(accountFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          courierId: 'courier-1',
          environment: CredentialEnvironment.PRODUCTION,
          isDefault: true,
          isActive: true,
          deletedAt: null,
        }),
      }),
    );
  });

  it('throws NO_COURIER_ACCOUNT_AVAILABLE when neither a link nor a default account exists', async () => {
    const { svc } = makeService({ links: [], defaultAccountId: null });
    await expect(
      svc.selectAccount('seller-1', 'courier-1', CredentialEnvironment.PRODUCTION),
    ).rejects.toMatchObject({ response: { code: 'NO_COURIER_ACCOUNT_AVAILABLE' } });
  });

  it('NO_COURIER_ACCOUNT_AVAILABLE is a NotFoundException', async () => {
    const { svc } = makeService({ links: [], defaultAccountId: null });
    await expect(
      svc.selectAccount('seller-1', 'courier-1', CredentialEnvironment.PRODUCTION),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('single active link: always picks that account (SELLER_LINK)', async () => {
    const { svc } = makeService({
      links: [{ courierAccountId: 'acct-a', distributionWeight: 100 }],
    });
    const result = await svc.selectAccount('seller-1', 'courier-1', CredentialEnvironment.PRODUCTION);
    expect(result).toEqual({ courierAccountId: 'acct-a', source: 'SELLER_LINK' });
  });

  it('two links weighted 70/30: a low roll picks the first, a high roll picks the second', async () => {
    const links = [
      { courierAccountId: 'acct-a', distributionWeight: 70 },
      { courierAccountId: 'acct-b', distributionWeight: 30 },
    ];
    randomSpy.mockReturnValueOnce(0.1); // 0.1 * 100 = 10 <= 70 → acct-a
    const { svc: svcLow } = makeService({ links });
    expect(
      (await svcLow.selectAccount('seller-1', 'courier-1', CredentialEnvironment.PRODUCTION)).courierAccountId,
    ).toBe('acct-a');

    randomSpy.mockReturnValueOnce(0.9); // 0.9 * 100 = 90 > 70 → falls into acct-b's remainder
    const { svc: svcHigh } = makeService({ links });
    expect(
      (await svcHigh.selectAccount('seller-1', 'courier-1', CredentialEnvironment.PRODUCTION)).courierAccountId,
    ).toBe('acct-b');
  });

  it('all-zero weights: degenerate case picks the first link deterministically', async () => {
    const { svc } = makeService({
      links: [
        { courierAccountId: 'acct-a', distributionWeight: 0 },
        { courierAccountId: 'acct-b', distributionWeight: 0 },
      ],
    });
    const result = await svc.selectAccount('seller-1', 'courier-1', CredentialEnvironment.PRODUCTION);
    expect(result).toEqual({ courierAccountId: 'acct-a', source: 'SELLER_LINK' });
  });

  it('only queries active links scoped to the requested (courier, environment)', async () => {
    const { svc, linkFindMany } = makeService({ links: [] });
    await svc.selectAccount('seller-9', 'courier-9', CredentialEnvironment.SANDBOX);
    expect(linkFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sellerId: 'seller-9',
          isActive: true,
          courierAccount: expect.objectContaining({
            courierId: 'courier-9',
            environment: CredentialEnvironment.SANDBOX,
            isActive: true,
            deletedAt: null,
          }),
        }),
      }),
    );
  });
});
