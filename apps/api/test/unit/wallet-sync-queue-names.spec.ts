import { readFileSync } from 'node:fs';
import {
  JOB_DELHIVERY_BILLING_PROBE,
  JOB_WALLET_SYNC,
  WALLET_SYNC_QUEUE,
} from '../../src/modules/courier-cost-sync/services/wallet-sync-trigger.service';
import {
  ACTION_DELHIVERY_BILLING_PROBED,
  DELHIVERY_BILLING_PROBE_PREFIX,
} from '../../src/modules/courier-cost-sync/services/delhivery-billing-probe-reader.service';

/**
 * The API and the portal worker must agree on where the job goes.
 *
 * They are separate processes and separate DI graphs on purpose: a
 * long-lived Chromium must not live in the process serving customer
 * HTTP, and `portal-worker-isolation.spec.ts` enforces that
 * `CourierPortalModule` stays unreachable from `AppModule`. So the API
 * cannot import the worker's constants — doing that for two strings
 * would drag the whole portal graph across the boundary the isolation
 * exists to keep.
 *
 * The price is a duplicated string, and this is what makes the price
 * safe to pay. Drift here has no symptom: the button would enqueue into
 * a queue nobody is listening to, return 200, and the run would simply
 * never happen — with nothing logged anywhere, because from the API's
 * side everything worked.
 *
 * Read from the SOURCE rather than imported, for the same reason the
 * isolation spec does: importing the worker module here would be the
 * very thing being avoided.
 */
const WORKER = 'src/modules/courier-portal/queue/wallet-sync.worker.ts';

function constantIn(file: string, name: string): string {
  const src = readFileSync(file, 'utf8');
  const m = new RegExp(`export const ${name} = '([^']+)'`).exec(src);
  if (m === null) throw new Error(`${name} not found in ${file} — was it renamed?`);
  return m[1] as string;
}

describe('the API enqueues where the portal worker listens', () => {
  it('agrees on the queue name', () => {
    expect(WALLET_SYNC_QUEUE).toBe(constantIn(WORKER, 'WALLET_SYNC_QUEUE'));
  });

  it('agrees on the job name', () => {
    // The worker ignores an unrecognised job name with a warning, so a
    // mismatch here is silent in exactly the same way.
    expect(JOB_WALLET_SYNC).toBe(constantIn(WORKER, 'JOB_WALLET_SYNC'));
  });

  it('agrees on the billing probe job name', () => {
    // Same silence: the probe button would return a runId whose findings
    // never arrive.
    expect(JOB_DELHIVERY_BILLING_PROBE).toBe(constantIn(WORKER, 'JOB_DELHIVERY_BILLING_PROBE'));
  });

  it('reads the audit action and bucket prefix the probe writes', () => {
    // The reader pairs a request with its result by these two strings; a
    // drift reads as "QUEUED" forever with the files sitting unlinked.
    expect(ACTION_DELHIVERY_BILLING_PROBED).toBe(
      constantIn(PROBE, 'ACTION_DELHIVERY_BILLING_PROBED'),
    );
    expect(DELHIVERY_BILLING_PROBE_PREFIX).toBe(
      `${constantIn(PROBE, 'DELHIVERY_BILLING_PROBE_PREFIX')}/`,
    );
  });
});

const PROBE = 'src/modules/courier-portal/services/delhivery-billing-probe.service.ts';
