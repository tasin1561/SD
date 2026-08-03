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
}
