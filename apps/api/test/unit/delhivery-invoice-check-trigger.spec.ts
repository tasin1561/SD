const add = jest.fn();
const close = jest.fn();
const ctor = jest.fn();

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string) => {
    ctor(name);
    return { add, close };
  }),
}));

import type { RedisService } from '../../src/infrastructure/redis/redis.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import { AdminDelhiveryInvoiceCheckController } from '../../src/modules/courier-cost-sync/controllers/admin-delhivery-invoice-check.controller';
import {
  JOB_DELHIVERY_INVOICE_CHECK,
  WALLET_SYNC_QUEUE,
  WalletSyncTriggerService,
} from '../../src/modules/courier-cost-sync/services/wallet-sync-trigger.service';
import type { AuthenticatedStaff } from '../../src/common/types/request';

describe('running the Delhivery invoice check now', () => {
  beforeEach(() => {
    add.mockReset().mockResolvedValue({ id: 'job-1' });
    close.mockReset().mockResolvedValue(undefined);
    ctor.mockReset();
  });

  const redis = { createConnection: () => ({}) } as unknown as RedisService;

  it('enqueues on the wallet sync queue — one attempt — and closes the producer', async () => {
    const res = await new WalletSyncTriggerService(redis).requestInvoiceCheck('staff-1');
    expect(ctor).toHaveBeenCalledWith(WALLET_SYNC_QUEUE);
    expect(add).toHaveBeenCalledWith(
      JOB_DELHIVERY_INVOICE_CHECK,
      { manual: true, requestedByStaffId: 'staff-1' },
      expect.objectContaining({ attempts: 1 }),
    );
    expect(close).toHaveBeenCalled();
    expect(res).toEqual({ queued: true, jobId: 'job-1' });
  });

  it('audits who asked BEFORE queuing, with no entity id', async () => {
    const order: string[] = [];
    const audit = {
      log: jest.fn().mockImplementation(async () => {
        order.push('audit');
        return 'a1';
      }),
    };
    const trigger = {
      requestInvoiceCheck: jest.fn().mockImplementation(async () => {
        order.push('enqueue');
        return { queued: true, jobId: 'job-1' };
      }),
    } as unknown as WalletSyncTriggerService;
    const controller = new AdminDelhiveryInvoiceCheckController(
      trigger,
      audit as unknown as AuditLogService,
    );
    const res = await controller.run({ id: 'staff-1' } as AuthenticatedStaff);
    expect(order).toEqual(['audit', 'enqueue']);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'courier.delhivery_invoices.check_requested',
        entityId: null,
      }),
    );
    expect(res).toEqual({ queued: true, jobId: 'job-1' });
  });
});
