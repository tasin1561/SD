import { WarehouseStatus } from '@skydrop/db';
import { WarehouseResolverService } from '../../src/modules/inventory-shared/warehouse-resolver.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

function makeSut(opts: {
  settingValue?: string | null;
  warehouse?: { id: string; code: string; name: string; status: WarehouseStatus } | null;
}) {
  const client = {
    systemSetting: {
      findUnique: jest.fn(async () =>
        opts.settingValue === undefined
          ? { valueString: 'wh-1' }
          : { valueString: opts.settingValue },
      ),
    },
    warehouse: {
      findFirst: jest.fn(async (args: { where: { id: string } }) =>
        opts.warehouse && opts.warehouse.id === args.where.id ? opts.warehouse : null,
      ),
    },
  };
  const prisma = { client } as unknown as PrismaService;
  return { svc: new WarehouseResolverService(prisma), client };
}

const WH = { id: 'wh-1', code: 'CCU-01', name: 'Bangalore', status: WarehouseStatus.ACTIVE };

describe('WarehouseResolverService', () => {
  it('getDefaultWarehouseId returns the configured, live warehouse id', async () => {
    const { svc } = makeSut({ settingValue: 'wh-1', warehouse: WH });
    expect(await svc.getDefaultWarehouseId()).toBe('wh-1');
  });

  it('throws when ops.default_warehouse_id is unset', async () => {
    const { svc } = makeSut({ settingValue: null, warehouse: WH });
    await expect(svc.getDefaultWarehouseId()).rejects.toMatchObject({
      response: { code: 'DEFAULT_WAREHOUSE_NOT_CONFIGURED' },
    });
  });

  it('throws when the configured id points at a missing/deleted warehouse', async () => {
    const { svc } = makeSut({ settingValue: 'gone', warehouse: WH });
    await expect(svc.getDefaultWarehouseId()).rejects.toMatchObject({
      response: { code: 'DEFAULT_WAREHOUSE_INVALID' },
    });
  });

  it('resolveWarehouseId: explicit id wins (validated)', async () => {
    const { svc } = makeSut({ settingValue: 'wh-1', warehouse: WH });
    expect(await svc.resolveWarehouseId('wh-1')).toBe('wh-1');
  });

  it('resolveWarehouseId: explicit-but-unknown id -> 404', async () => {
    const { svc } = makeSut({ settingValue: 'wh-1', warehouse: WH });
    await expect(svc.resolveWarehouseId('nope')).rejects.toMatchObject({
      response: { code: 'WAREHOUSE_NOT_FOUND' },
    });
  });

  it('resolveWarehouseId: no id -> configured default', async () => {
    const { svc } = makeSut({ settingValue: 'wh-1', warehouse: WH });
    expect(await svc.resolveWarehouseId()).toBe('wh-1');
  });

  it('requireWarehouse returns the row or throws 404', async () => {
    const { svc } = makeSut({ settingValue: 'wh-1', warehouse: WH });
    expect(await svc.requireWarehouse('wh-1')).toMatchObject({ code: 'CCU-01' });
    await expect(svc.requireWarehouse('x')).rejects.toMatchObject({
      response: { code: 'WAREHOUSE_NOT_FOUND' },
    });
  });
});
