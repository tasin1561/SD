import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '../../config/env.service';

/**
 * Which API process owns the queues.
 *
 * Every worker in this codebase starts itself in `onModuleInit`, which
 * was correct while exactly one API process existed. It is what stops
 * there being a second: run two instances behind a load balancer and
 * every cron fires twice, every scheduler registers a duplicate delayed
 * job, and every queue is consumed by two competing worker pools.
 *
 * Most of the sweeps are idempotent by design — the guarded
 * `updateMany` claims mean a double-fire is usually absorbed. "Usually
 * absorbed" is not a foundation to put horizontal scaling on, and the
 * schedulers are not idempotent at all: two processes registering the
 * same repeatable job produce two of it.
 *
 * So the split is explicit. Every instance serves HTTP; exactly one
 * carries `WORKERS_ENABLED=true` and owns the background work. That one
 * line in the environment is the whole difference between "we run one
 * server" and "we can run as many as we need".
 *
 * A worker that skips says so ONCE, at boot, at info level — the
 * failure this prevents is silent, so its absence should not be.
 */
@Injectable()
export class WorkerRoleService {
  private readonly logger = new Logger(WorkerRoleService.name);

  constructor(private readonly env: EnvService) {}

  /** True when this process should start background workers. */
  get enabled(): boolean {
    return this.env.workersEnabled;
  }

  /**
   * True in the process that owns the BROWSER queues.
   *
   * A second flag, not a second value of the first, because the two
   * answer different questions and a single one cannot be right for
   * both. The portal process boots a module graph that transitively
   * pulls in EmailModule and the escalation queues; with a shared flag,
   * turning its own workers on turned THOSE on too — two processes
   * owning one queue, which is precisely the double-firing SCALE-1
   * exists to prevent. Observed live: starting the portal duplicated the
   * email and waybill-refill workers against the API.
   */
  get portalEnabled(): boolean {
    return process.env['PORTAL_WORKERS_ENABLED'] === 'true';
  }

  /**
   * Call at the top of a worker's `onModuleInit`. Returns false when
   * this process is HTTP-only, having logged which worker stood down.
   */
  shouldStart(workerName: string): boolean {
    if (this.env.workersEnabled) return true;
    this.logger.log(
      `${workerName} not started — WORKERS_ENABLED=false, this instance serves HTTP only`,
    );
    return false;
  }

  /**
   * The portal process's own gate. Same shape as `shouldStart`, and
   * deliberately NOT falling back to it: a worker that drives a browser
   * must never start just because the general workers are on, or every
   * API instance would launch Chromium.
   */
  shouldStartPortal(workerName: string): boolean {
    if (this.portalEnabled) return true;
    this.logger.log(
      `${workerName} not started — PORTAL_WORKERS_ENABLED is not 'true' in this process`,
    );
    return false;
  }
}
