/**
 * The two FILMING STACKS, declared once.
 *
 * WHY THIS EXISTS. Thirty tutorials remain at roughly 1.2 videos an
 * hour, so two agents filming at once is worth a day. The only thing
 * that stopped it was the SHARED WORLD: `seed-demo-data.mjs` rebuilds
 * the demo seller, its catalogue, its orders and its parcels before
 * EVERY take, so two agents on one database reseed under each other
 * mid-scene and both takes are ruined — silently, because a reseeded
 * order list looks like a flow that stopped working.
 *
 * A stack is therefore every piece of state a take touches, and this
 * table is the ONE place that says which: a database, a Redis DB index,
 * four ports, an object-storage bucket, and a suffix for the recording
 * directories. The same discipline `BinPolicyService` and
 * `WarehouseResolverService` keep — five call sites each deciding what
 * "the API" means is how they come to disagree, and here the
 * disagreement is one agent's seed wiping the other's world.
 *
 * STACK NAMES ARE REQUIRED, NEVER DEFAULTED. `resolveStack()` throws
 * when `TUT_STACK` is unset. A default of `a` would mean an agent
 * filming on B seeds A by forgetting a flag, which is exactly the
 * accident this whole file exists to prevent — and it would be
 * invisible: the seed would report success, against the wrong world.
 *
 *   eval "$(node scripts/tutorials/lib/stacks.mjs --env b)"
 *   node scripts/tutorials/lib/stacks.mjs --json b
 *   node scripts/tutorials/lib/stacks.mjs --list
 */

/** Postgres, Redis and the mock object store are SHARED SERVERS; only the namespaces differ. */
const PG = { host: '127.0.0.1', port: 5432, user: 'skydrop', password: 'skydrop' };
const REDIS_HOST = '127.0.0.1';
const REDIS_PORT = 6379;

/**
 * Database names that are NOT a filming stack and must never be one.
 *
 * `skydrop_test` is dropped and recreated by `apps/api/test/e2e/global-setup.ts`
 * on every e2e run — a stack pointed there would have its world deleted
 * out from under a take by a test suite somebody started in another
 * terminal, and the symptom would be a flow failing at sign-in.
 */
export const RESERVED_DATABASES = Object.freeze([
  'skydrop_test',
  'postgres',
  'template0',
  'template1',
]);

/**
 * @typedef {object} StackService
 * @property {number} port
 * @property {string} url
 */

/**
 * @typedef {object} Stack
 * @property {string} name          `a` or `b`
 * @property {string} database      Postgres database name
 * @property {string} databaseUrl
 * @property {number} redisDb       Redis logical DB index — the QUEUE namespace
 * @property {string} redisUrl
 * @property {string} spacesBucket  also the mock-object directory name
 * @property {string} outSuffix     appended to out/raw, out/work, out/verify
 * @property {StackService} api
 * @property {StackService} seller
 * @property {StackService} admin
 * @property {StackService} reseller
 * @property {StackService} associate
 * @property {StackService} sim
 */

function service(port) {
  return Object.freeze({ port, url: `http://127.0.0.1:${port}` });
}

function stack({
  name,
  database,
  redisDb,
  spacesBucket,
  outSuffix,
  api,
  seller,
  admin,
  reseller,
  associate,
  sim,
}) {
  return Object.freeze({
    name,
    database,
    databaseUrl: `postgresql://${PG.user}:${PG.password}@${PG.host}:${PG.port}/${database}?schema=public`,
    redisDb,
    // ioredis reads the URL PATH as the logical DB index, and BullMQ uses
    // whatever connection it is handed — so a distinct index is a
    // distinct `bull:*` keyspace with no shared key at all. This is the
    // isolation that matters most: two API processes on one index would
    // each pick up the other's jobs (SCALE-1), so a tracking webhook
    // meant for stack B's parcel would be processed against stack A's
    // database and land as a mysteriously missing scan.
    redisUrl: `redis://${REDIS_HOST}:${REDIS_PORT}/${redisDb}`,
    spacesBucket,
    outSuffix,
    api: service(api),
    seller: service(seller),
    admin: service(admin),
    reseller: service(reseller),
    associate: service(associate),
    sim: service(sim),
  });
}

/**
 * The stacks. Adding a third means adding a row here and nothing else —
 * every script asks this table rather than carrying a port.
 *
 * Stack `a` is the ORIGINAL configuration, port for port and name for
 * name, so the commands that were already being typed keep driving
 * exactly the same processes.
 */
export const STACKS = Object.freeze({
  a: stack({
    name: 'a',
    database: 'skydrop',
    redisDb: 0,
    spacesBucket: 'skydrop-storage',
    outSuffix: '',
    api: 4000,
    seller: 3003,
    admin: 3002,
    reseller: 3005,
    associate: 3007,
    sim: 4010,
  }),
  b: stack({
    name: 'b',
    database: 'skydrop_tut_b',
    redisDb: 1,
    spacesBucket: 'skydrop-storage-tut-b',
    outSuffix: '-b',
    api: 4100,
    seller: 3103,
    admin: 3102,
    reseller: 3105,
    associate: 3107,
    sim: 4110,
  }),
});

export const STACK_NAMES = Object.freeze(Object.keys(STACKS));

/**
 * Which stack this process is working on — REQUIRED, never guessed.
 *
 * @param {string | undefined} [name] defaults to `TUT_STACK`
 * @returns {Stack}
 */
export function resolveStack(name = process.env.TUT_STACK) {
  if (name === undefined || name.trim() === '') {
    throw new Error(
      'TUT_STACK is not set, and there is deliberately no default.\n' +
        `  Filming stacks: ${STACK_NAMES.join(', ')}.\n` +
        '  Say which one, e.g.  TUT_STACK=a scripts/tutorials/make-tutorials.sh <slug>\n' +
        '  A default of "a" would let an agent filming on another stack reseed A by\n' +
        '  forgetting a flag, and the seed would report success against the wrong world.',
    );
  }
  const key = name.trim().toLowerCase();
  const found = STACKS[key];
  if (found === undefined) {
    throw new Error(`No filming stack named "${name}". Known stacks: ${STACK_NAMES.join(', ')}.`);
  }
  return found;
}

/**
 * The environment a stack's processes and scripts run under.
 *
 * Every name here is a seam that ALREADY existed — `SKYDROP_API_URL`,
 * `SELLER_APP_URL`, `SIM_URL`, `SPACES_BUCKET` — which is why a second
 * stack needs no new switch inside the app. The point of returning them
 * together is that they cannot be set half-way: a `DATABASE_URL` for B
 * beside a `REDIS_URL` for A is a take whose jobs run against the other
 * world.
 *
 * `PORT` and `API_ORIGIN` are for the SERVERS (apps/api, and the Next
 * proxy in apps/seller and apps/admin); the rest are read by the
 * recording scripts.
 *
 * @param {Stack} stack
 * @returns {Record<string, string>}
 */
export function stackEnvironment(stack) {
  return {
    TUT_STACK: stack.name,
    DATABASE_URL: stack.databaseUrl,
    REDIS_URL: stack.redisUrl,
    SPACES_BUCKET: stack.spacesBucket,
    PORT: String(stack.api.port),
    BIND_HOST: '127.0.0.1',
    API_ORIGIN: stack.api.url,
    SKYDROP_API_URL: stack.api.url,
    SELLER_APP_URL: stack.seller.url,
    ADMIN_APP_URL: stack.admin.url,
    RESELLER_APP_URL: stack.reseller.url,
    ASSOCIATE_APP_URL: stack.associate.url,
    SIM_URL: stack.sim.url,
  };
}

/** The Postgres database name a URL points at, or null if it is unreadable. */
export function databaseNameOf(url) {
  try {
    const u = new URL(url);
    const name = u.pathname.replace(/^\/+/, '');
    return name === '' ? null : name;
  } catch {
    return null;
  }
}

/** The Redis logical DB index a URL selects. No path means index 0. */
export function redisDbOf(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+/, '');
    if (path === '') return 0;
    const n = Number(path);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'redis';
}

/**
 * Refuse to run unless the AMBIENT environment is the stack's own.
 *
 * This is the guard that actually stops cross-contamination, and it is
 * DERIVED rather than stored — no marker row, nothing written, so it
 * worked for stack A the moment it was added and it cannot drift.
 *
 * The failure it catches is specific and was already present in the
 * pipeline: `make-tutorials.sh` sources `apps/api/.env` with `set -a`,
 * and that file hard-sets `DATABASE_URL` to stack A's database and
 * `REDIS_URL` to index 0. So a run that says `TUT_STACK=b` but has not
 * applied the stack's environment AFTERWARDS would connect Prisma to A,
 * seed A, and film B — reporting success the whole way. Asking the
 * connection string which database it names is the cheapest possible
 * proof that the override landed.
 *
 * It subsumes the old `assertLocal`: a non-local host can never match a
 * stack's own URL, and the message says so plainly, because the thing on
 * the other end of a non-local URL is a real deployment with real
 * sellers in it.
 *
 * @param {Stack} stack
 * @param {{ requireRedis?: boolean }} [opts] Redis is not needed by every script
 */
export function assertStackEnvironment(stack, { requireRedis = true } = {}) {
  const problems = [];

  const dbUrl = process.env.DATABASE_URL ?? '';
  const dbHost = hostOf(dbUrl);
  const dbName = databaseNameOf(dbUrl);
  if (dbHost === null || !isLocalHost(dbHost)) {
    problems.push(
      `DATABASE_URL host is "${dbHost ?? '(unreadable)'}" — a filming stack is local only, ` +
        'and the far end of a non-local URL has real sellers in it.',
    );
  } else if (dbName !== stack.database) {
    problems.push(
      `DATABASE_URL names database "${dbName ?? '(none)'}" but stack ${stack.name} is ` +
        `"${stack.database}". Seeding would rebuild the WRONG world.`,
    );
  }
  if (dbName !== null && dbName !== stack.database && RESERVED_DATABASES.includes(dbName)) {
    problems.push(`"${dbName}" is reserved and must never be filmed against.`);
  }

  if (requireRedis) {
    const redisUrl = process.env.REDIS_URL ?? '';
    const redisHost = hostOf(redisUrl);
    const redisDb = redisDbOf(redisUrl);
    if (redisHost === null || !isLocalHost(redisHost)) {
      problems.push(`REDIS_URL host is "${redisHost ?? '(unreadable)'}" — local only.`);
    } else if (redisDb !== stack.redisDb) {
      problems.push(
        `REDIS_URL selects logical DB ${redisDb ?? '(unreadable)'} but stack ${stack.name} owns ` +
          `DB ${stack.redisDb}. Sharing an index means each stack's API picks up the other's ` +
          'BullMQ jobs (SCALE-1).',
      );
    }
  }

  const bucket = process.env.SPACES_BUCKET ?? 'skydrop-storage';
  if (bucket !== stack.spacesBucket) {
    problems.push(
      `SPACES_BUCKET is "${bucket}" but stack ${stack.name} owns "${stack.spacesBucket}" — ` +
        'the mock object store is one directory per bucket, so sharing one means two stacks ' +
        "overwriting each other's labels and logos.",
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Environment does not belong to filming stack "${stack.name}":\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        "\n\nApply the stack's own environment first:\n" +
        `  eval "$(node scripts/tutorials/lib/stacks.mjs --env ${stack.name})"\n` +
        `or run the command through it:\n` +
        `  scripts/tutorials/stack.sh run ${stack.name} -- <command>\n`,
    );
  }
}

/** `export K='V'` lines, for `eval`. Single-quoted; nothing here contains a quote. */
export function envExportScript(stack) {
  return Object.entries(stackEnvironment(stack))
    .map(([k, v]) => `export ${k}='${v}'`)
    .join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // A clean message, not a stack trace: this script's whole job when it
  // fails is to tell a person which flag to type, and a V8 trace above
  // the instruction is how an instruction gets scrolled past.
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const s of Object.values(STACKS)) {
      console.log(
        `${s.name}  db=${s.database}  redis=${s.redisDb}  api=${s.api.port}  ` +
          `seller=${s.seller.port}  admin=${s.admin.port}  sim=${s.sim.port}  ` +
          `bucket=${s.spacesBucket}  out=${s.outSuffix === '' ? '(unsuffixed)' : s.outSuffix}`,
      );
    }
  } else if (args.includes('--json')) {
    const name = args.find((a) => !a.startsWith('--'));
    console.log(JSON.stringify(resolveStack(name), null, 2));
  } else if (args.includes('--env')) {
    const name = args.find((a) => !a.startsWith('--'));
    console.log(envExportScript(resolveStack(name)));
  } else {
    throw new Error('usage: node scripts/tutorials/lib/stacks.mjs [--env|--json] <stack> | --list');
  }
}
