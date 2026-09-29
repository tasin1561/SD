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
