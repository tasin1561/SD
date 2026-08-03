import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'node:fs';
import { WorkerRoleService } from '../../src/common/queue/worker-role.service';
import { makeTestEnv } from '../helpers/env';

/**
 * Which process owns the queues.
 *
 * Every worker starts itself in `onModuleInit`. That was fine while
 * exactly one API process existed, and it is precisely what stopped
 * there being a second: two instances behind a load balancer would run
 * every cron twice and register duplicate delayed jobs.
 *
 * The gate is one env flag, which means the whole property rests on
 * every worker actually consulting it. A worker that forgets is
 * invisible — it works perfectly on one instance and silently
 * double-fires on two — so the check is structural rather than
 * behavioural.
 */
describe('WorkerRoleService', () => {
  it('starts workers when this process owns the queues', () => {
    const svc = new WorkerRoleService(makeTestEnv({ WORKERS_ENABLED: true }));
    expect(svc.enabled).toBe(true);
    expect(svc.shouldStart('AnyWorker')).toBe(true);
  });

  it('stands them down when it does not', () => {
    const svc = new WorkerRoleService(makeTestEnv({ WORKERS_ENABLED: false }));
    expect(svc.enabled).toBe(false);
    expect(svc.shouldStart('AnyWorker')).toBe(false);
  });
});

describe('every in-process worker consults the gate', () => {
  const files = globSync('src/modules/*/queue/*.worker.ts', {
    cwd: resolve(__dirname, '../..'),
  });

  it('finds the workers to check', () => {
    // Guards against the glob silently matching nothing, which would
    // make the suite below pass by testing air.
    expect(files.length).toBeGreaterThanOrEqual(16);
  });

  it.each(files)('%s calls shouldStart before starting', (file) => {
    const src = readFileSync(resolve(__dirname, '../..', file), 'utf8');
    // A worker that starts unconditionally is the bug: it works on one
    // instance and double-fires on two.
    expect(src).toContain('workerRole.shouldStart');
    const gateAt = src.indexOf('workerRole.shouldStart');
    // Generic form too: several workers are `new Worker<JobType>(`.
    const startAt = src.search(/new Worker\s*(<[^>]*>)?\s*\(/);
    expect(gateAt).toBeGreaterThan(-1);
    expect(startAt).toBeGreaterThan(gateAt);
  });
});
