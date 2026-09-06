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
  /**
   * EVERY file that constructs a Worker, wherever it lives.
   *
   * This used to glob only the `queue` folder's `.worker.ts` files,
   * which is where most of them
   * are and not where all of them are: three files built a Worker from a
   * `.queue.ts` or a `.service.ts` and escaped the check entirely. One
   * was the auto-withdrawal sweep — a MONEY path that would have paid
   * every eligible seller twice the moment a second API instance
   * existed. A guard that only inspects the files following the naming
   * convention is a guard against typos, not against the failure.
   *
   * So the file list is derived from the thing itself: anything
   * containing `new Worker(`.
   */
  const root = resolve(__dirname, '../..');
  const files = globSync('src/modules/**/*.ts', { cwd: root }).filter((f) =>
    /new Worker\s*(<[^>]*>)?\s*\(/.test(readFileSync(resolve(root, f), 'utf8')),
  );

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

/**
 * Every worker's failures reach the board.
 *
 * `/system-issues` is where a person looks to answer "is anything
 * broken". That only works if every background worker actually reports,
 * and a worker that forgets is invisible in exactly the way that
 * matters: it behaves perfectly until the day its work stops happening,
 * and then it stops SILENTLY. Nothing breaks, no screen changes,
 * figures simply stop moving.
 *
 * Five workers had already drifted when this was written — four never
 * reported an exhausted job (agent-presence, waybill-refill,
 * wallet-sync, nsa-sweep) and one was blind to its own connection
 * errors (ndr). None of it was deliberate; each was a hook somebody did
 * not copy. So the check is STRUCTURAL, over the same derived file list
 * as the gate above: anything that constructs a Worker must wire both
 * hooks, and a sixth one cannot drift without this failing.
 *
 * The two are deliberately separate reports, and both are required:
 * `error` is usually a Redis blip, while an EXHAUSTED job is a piece of
 * work that definitively did not happen.
 */
describe('every in-process worker reports its failures', () => {
  const root = resolve(__dirname, '../..');
  const files = globSync('src/modules/**/*.ts', { cwd: root }).filter((f) =>
    /new Worker\s*(<[^>]*>)?\s*\(/.test(readFileSync(resolve(root, f), 'utf8')),
  );

  it('finds the workers to check', () => {
    expect(files.length).toBeGreaterThanOrEqual(16);
  });

  it.each(files)('%s reports an exhausted job', (file) => {
    const src = readFileSync(resolve(root, file), 'utf8');
    // Via the service, not merely logged: a log line is not somewhere
    // anybody looks before being told there is something to look for.
    expect(src).toContain("on('failed'");
    expect(src).toContain('reportJobFailure');
  });

  it.each(files)('%s reports its own worker errors', (file) => {
    const src = readFileSync(resolve(root, file), 'utf8');
    expect(src).toContain("on('error'");
    expect(src).toContain('reportWorkerError');
  });
});
