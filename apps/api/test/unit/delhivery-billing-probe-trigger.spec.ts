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
import { AdminDelhiveryBillingProbeController } from '../../src/modules/courier-cost-sync/controllers/admin-delhivery-billing-probe.controller';
import type { DelhiveryBillingProbeReaderService } from '../../src/modules/courier-cost-sync/services/delhivery-billing-probe-reader.service';
import {
  JOB_DELHIVERY_BILLING_PROBE,
  WALLET_SYNC_QUEUE,
  WalletSyncTriggerService,
} from '../../src/modules/courier-cost-sync/services/wallet-sync-trigger.service';
import type { AuthenticatedStaff } from '../../src/common/types/request';

describe('queuing the Delhivery billing probe', () => {
  beforeEach(() => {
    add.mockReset().mockResolvedValue({ id: 'job-1' });
    close.mockReset().mockResolvedValue(undefined);
    ctor.mockReset();
  });

  const redis = { createConnection: () => ({}) } as unknown as RedisService;

  it('enqueues on the wallet sync queue, by the probe job name, once, and closes the producer', async () => {
    const trigger = new WalletSyncTriggerService(redis);
    const res = await trigger.requestBillingProbe(
      '0199a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b',
      'staff-1',
    );

    expect(ctor).toHaveBeenCalledWith(WALLET_SYNC_QUEUE);
    expect(add).toHaveBeenCalledWith(
      JOB_DELHIVERY_BILLING_PROBE,
      {
        manual: true,
        runId: '0199a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b',
        requestedByStaffId: 'staff-1',
      },
      expect.objectContaining({
        attempts: 1,
        jobId: 'delhivery-billing-probe-0199a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b',
      }),
    );
    // Colon-free: a colon is Redis's key separator.
    expect((add.mock.calls[0]?.[2] as { jobId: string }).jobId).not.toContain(':');
    expect(close).toHaveBeenCalled();
    expect(res).toEqual({ queued: true, jobId: 'job-1' });
  });

  it('audits who asked BEFORE queuing, and returns the run id it queued', async () => {
    const order: string[] = [];
    const audit = {
      log: jest.fn().mockImplementation(async () => {
        order.push('audit');
        return 'a1';
      }),
    } as unknown as AuditLogService;
    const trigger = {
      requestBillingProbe: jest.fn().mockImplementation(async () => {
        order.push('enqueue');
        return { queued: true, jobId: 'job-1' };
      }),
    } as unknown as WalletSyncTriggerService;
    const controller = new AdminDelhiveryBillingProbeController(
      trigger,
      {} as DelhiveryBillingProbeReaderService,
      audit,
    );
    const res = await controller.run({ id: 'staff-1' } as AuthenticatedStaff);

    expect(order).toEqual(['audit', 'enqueue']);
    expect(res.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(trigger.requestBillingProbe).toHaveBeenCalledWith(res.runId, 'staff-1');
    expect((audit.log as jest.Mock).mock.calls[0]?.[0]).toMatchObject({
      action: 'courier.delhivery_billing.probe_requested',
      entityId: null,
      metadata: { courierCode: 'delhivery', runId: res.runId },
    });
  });

  it('refuses a runId that is not a uuid', () => {
    const controller = new AdminDelhiveryBillingProbeController(
      {} as WalletSyncTriggerService,
      { view: jest.fn() } as unknown as DelhiveryBillingProbeReaderService,
      {} as AuditLogService,
    );
    expect(() => controller.view('../../etc')).toThrow();
  });
});
