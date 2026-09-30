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

/**
 * The SAME PDF library the label sheet merges with.
 *
 * Borrowed for one purpose, in J3's seeding: the LABEL LEG CANNOT
 * SUCCEED against the local Delhivery simulator. `DelhiveryLabelService`
 * puts the courier's `pdf_download_link` through `assertPublicHttpsUrl`
 * — the same SSRF guard a seller-supplied webhook URL goes through,
 * because the bytes end up in our bucket and are later presigned for a
 * seller to open — and the simulator's link is `http://127.0.0.1`, which
 * that guard refuses on the scheme before it even looks at the address.
 * Correct product behaviour and a permanent local gap: 64 shipments on
 * this box carry a waybill and 10 carry a label.
 *
 * So the seeding writes the label the real path would have written, and
 * it has to be a PDF something can actually MERGE — `LabelSheetService`
 * loads each one with pdf-lib and reports an unreadable file as
 * UNREADABLE_PDF, so a hand-rolled `%PDF` header would fail one layer
 * further along and look like a different problem.
 */
export const pdfLib = requireFromApi('pdf-lib');
