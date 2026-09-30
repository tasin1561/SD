/**
 * Runtime deps for the tutorial scripts.
 *
 * The workspace ROOT has only build tooling in `node_modules` — no
 * Prisma client, no argon2 — because nothing at the root is meant to run
 * against the database. These recording scripts do, so they borrow
 * `apps/api`'s resolution root rather than adding a workspace package
 * (which would mean editing `pnpm-workspace.yaml` and rewriting the
 * lockfile for a script that produces two mp4s).
 *
 * `createRequire` is the only thing that can do this: NODE_PATH is
 * ignored by ESM resolution, so an env var would silently not work.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

const requireFromApi = createRequire(path.join(REPO_ROOT, 'apps', 'api', 'package.json'));

/** @type {{ prisma: import('@prisma/client').PrismaClient }} */
const db = requireFromApi('@skydrop/db');
export const prisma = db.prisma;
export const argon2 = requireFromApi('argon2');

/** The SAME client apps/api throttles with, so the keys are read the same way. */
export const Redis = requireFromApi('ioredis').default ?? requireFromApi('ioredis');

/**
 * The SAME queue library apps/api runs its crons on.
 *
 * Borrowed for one purpose, in `lib/freight.mjs`: a delivered order's
 * money waits `wallet.accrual_delay_days` on the default T+N tier, and a
 * recording box cannot wait a week for a screen to have something on it.
 * The seed pulls that one row's due date forward and then asks the
 * HOURLY SWEEP to run now, by adding the job its own cron adds — which
 * is an early tick, not a bypass: `PendingAccrualSweepService` does all
 * the work and its gates are unchanged.
 */
export const BullMQ = requireFromApi('bullmq');
