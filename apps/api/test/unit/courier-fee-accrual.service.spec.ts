import { Currency } from '@skydrop/db';
import { CourierFeeAccrualService } from '../../src/modules/seller-wallet-accrual/services/courier-fee-accrual.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { WalletService } from '../../src/modules/seller-wallet/services/wallet.service';
import type { OrderChargesAccrualService } from '../../src/modules/seller-wallet-accrual/services/order-charges-accrual.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';

type AnyArgs = Record<string, unknown>;

function makeService(
  opts: {
    order?: AnyArgs | null;
    settingValue?: string;
    debitResult?: boolean;
    debitThrows?: Error;
    settingsThrows?: Error;
  } = {},
) {
  const orderFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.order === undefined ? { id: 'order-1', sellerId: 'seller-1' } : opts.order,
  );
  const $transaction = jest.fn(async (fn: (tx: unknown) => Promise<boolean>) => fn({}));
  const client = { order: { findUnique: orderFindUnique }, $transaction };
  const prisma = { client } as unknown as PrismaService;

  const recomputeCacheAfterCommit = jest.fn(async () => undefined);
  const wallet = { recomputeCacheAfterCommit };

  const debitIfNeeded = jest.fn(async () => {
    if (opts.debitThrows) throw opts.debitThrows;
    return opts.debitResult ?? true;
  });
  const chargesAccrual = { debitIfNeeded };

  const resolve = jest.fn(async () => {
    if (opts.settingsThrows) throw opts.settingsThrows;
    return {
      key: 'wallet.courier_fee_deduction_timing',
      valueType: 'STRING',
      value: opts.settingValue ?? 'AT_DELIVERY',
      source: 'SYSTEM_DEFAULT' as const,
    };
  });
  const settings = { resolve };

  const svc = new CourierFeeAccrualService(
    prisma,
    wallet as unknown as WalletService,
    chargesAccrual as unknown as OrderChargesAccrualService,
    settings as unknown as SettingsResolverService,
  );
  return { svc, orderFindUnique, resolve, debitIfNeeded, recomputeCacheAfterCommit, $transaction };
}

describe('CourierFeeAccrualService.tryEarlyAccrual', () => {
  it('no-ops for the default AT_DELIVERY setting — never debits', async () => {
    const { svc, debitIfNeeded, recomputeCacheAfterCommit } = makeService({ settingValue: 'AT_DELIVERY' });
    await svc.tryEarlyAccrual('order-1');
    expect(debitIfNeeded).not.toHaveBeenCalled();
    expect(recomputeCacheAfterCommit).not.toHaveBeenCalled();
  });

  it('AT_AWB: debits inside its own transaction and recomputes the cache', async () => {
    const { svc, debitIfNeeded, recomputeCacheAfterCommit, resolve } = makeService({
      settingValue: 'AT_AWB',
      debitResult: true,
    });
    await svc.tryEarlyAccrual('order-1');
    expect(resolve).toHaveBeenCalledWith('seller-1', 'wallet.courier_fee_deduction_timing');
    expect(debitIfNeeded).toHaveBeenCalledWith(expect.anything(), 'order-1', 'seller-1');
    expect(recomputeCacheAfterCommit).toHaveBeenCalledWith('seller-1', Currency.INR, 'post-commit-awb-accrual');
  });

  it('AT_AWB but debitIfNeeded returns false (already debited): skips cache recompute', async () => {
    const { svc, recomputeCacheAfterCommit } = makeService({ settingValue: 'AT_AWB', debitResult: false });
    await svc.tryEarlyAccrual('order-1');
    expect(recomputeCacheAfterCommit).not.toHaveBeenCalled();
  });

  it('no-ops when the order does not exist (never throws)', async () => {
    const { svc, debitIfNeeded } = makeService({ order: null });
    await expect(svc.tryEarlyAccrual('missing')).resolves.toBeUndefined();
    expect(debitIfNeeded).not.toHaveBeenCalled();
  });

  it('swallows a debitIfNeeded failure — never throws (AWB generation must never be blocked)', async () => {
    const { svc } = makeService({ settingValue: 'AT_AWB', debitThrows: new Error('ledger boom') });
    await expect(svc.tryEarlyAccrual('order-1')).resolves.toBeUndefined();
  });

  it('swallows a settings-resolution failure — never throws', async () => {
    const { svc } = makeService({ settingsThrows: new Error('settings boom') });
    await expect(svc.tryEarlyAccrual('order-1')).resolves.toBeUndefined();
  });
});
