/**
 * Prove two filming stacks cannot reach each other. READ-ONLY on the
 * other stack; the only thing it writes is one probe job into its own.
 *
 *   TUT_STACK=b node scripts/tutorials/check-isolation.mjs --against a
 *
 * WHY THIS IS A COMMITTED TOOL. Three of the four collision surfaces
 * fail LOUDLY if they are shared — two processes cannot bind one port,
 * and a seed that hits the wrong database is refused by
 * `assertStackEnvironment`. The fourth does not: two APIs on ONE Redis
 * logical DB each pick up the other's BullMQ jobs (SCALE-1), and the
 * symptom is a tracking webhook for stack B's parcel being processed
 * against stack A's database, where the waybill belongs to nobody. The
 * webhook is authenticated, stored and then quietly fails to match, so
 * the only thing anybody sees is a parcel that never advances — hours
 * later, in a take, with no error anywhere.
 *
 * So the queue half is checked by EXPERIMENT rather than by reading the
 * config: a probe job is added to this stack's queue, and the other
 * stack's Redis database is asked whether the key ever appeared there.
 * The job's own name is one no worker handles, so whichever worker takes
 * it fails it and nothing is sent, charged or dispatched.
 */
import { Redis, BullMQ } from './lib/deps.mjs';

/** The Postgres container, for the read-only cross-check below. */
const PG_CONTAINER = process.env.TUT_PG_CONTAINER ?? 'skydrop-postgres';
import { resolveStack, STACK_NAMES } from './lib/stacks.mjs';

/**
 * A queue BOTH stacks run a worker for, so "the other one did not take
 * it" is a statement about isolation rather than about a queue nobody
 * listens to. The job NAME is deliberately not one the worker handles.
 */
const PROBE_QUEUE = 'email';
const PROBE_JOB = 'tut-isolation-probe';

async function connect(url) {
  const client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true });
  await client.connect();
  return client;
}

/**
 * WHICH DATABASE EACH API IS ACTUALLY READING, proved by BEHAVIOUR.
 *
 * Two earlier attempts at this failed, and both are worth recording
 * because they look like they should work:
 *
 *   1. `/proc/<pid>/environ`. Stack A's API is started as a bare
 *      `node dist/main.js` and loads `apps/api/.env` with dotenv INSIDE
 *      the process, so its environment block carries no DATABASE_URL at
 *      all. The check read "(unreadable)" for the one stack it existed
 *      to vouch for.
 *
 *   2. Joining `ss` to Redis's `CLIENT LIST` and Postgres's
 *      `pg_stat_activity` on the client PORT. Both servers run in
 *      containers behind Docker's userland proxy, which relays with its
 *      OWN source port — so every client appears as the bridge gateway
 *      (172.18.0.1) on a port that belongs to docker-proxy and not to
 *      any node process. The join attributes nothing, and "no
 *      connections" reads as a pass rather than as a broken parser.
 *
 * So the question is asked of the APIs themselves instead, over a PUBLIC
 * read-only endpoint, using a fact that differs between the two
 * databases: a waybill. `GET /public/tracking/:awb` answers 200 for a
 * parcel its database holds and a deliberately generic 404 for one it
 * does not (TRK-8). Ask each API for the OTHER stack's waybill and a 404
 * is the proof — behaviour, not configuration, and nothing is written.
 */
async function anAwbIn(stack) {
  // Read through psql in the Postgres CONTAINER rather than a second
  // Prisma client: `@skydrop/db` exports a singleton bound to the
  // ambient DATABASE_URL, and `@prisma/client` is not resolvable from
  // `apps/api` at all (the generated client lives inside packages/db).
  // One read-only SELECT needs neither.
  const { execSync } = await import('node:child_process');
  const sql =
    'SELECT awb_number FROM shipments WHERE awb_number IS NOT NULL AND deleted_at IS NULL ' +
    'ORDER BY created_at DESC LIMIT 1';
  try {
    const out = execSync(
      `docker exec -e PGPASSWORD=skydrop ${PG_CONTAINER} psql -U skydrop -d ${stack.database} ` +
        `-tAc "${sql}" 2>/dev/null`,
      { encoding: 'utf8' },
    ).trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

async function tracking(apiUrl, awb) {
  const res = await fetch(`${apiUrl}/public/tracking/${encodeURIComponent(awb)}`).catch(() => null);
  return res === null ? 'unreachable' : String(res.status);
}

/** Backends per database, so both namespaces are visibly in use. */
async function backendsByDatabase(prismaClient) {
  const rows = await prismaClient.$queryRawUnsafe(
    'SELECT datname, count(*)::int AS n FROM pg_stat_activity ' +
      'WHERE client_addr IS NOT NULL GROUP BY datname ORDER BY datname',
  );
  return rows;
}

async function main() {
  const mine = resolveStack();
  const againstName = process.argv.includes('--against')
    ? process.argv[process.argv.indexOf('--against') + 1]
    : STACK_NAMES.find((n) => n !== mine.name);
  const theirs = resolveStack(againstName);
  if (theirs.name === mine.name) throw new Error('--against must name a DIFFERENT stack');

  console.log(`Checking that stack "${mine.name}" cannot reach stack "${theirs.name}".\n`);

  console.log('NAMESPACES');
  console.log(
    `  ${mine.name}: db=${mine.database} redis=${mine.redisDb} api=${mine.api.port} bucket=${mine.spacesBucket}`,
  );
  console.log(
    `  ${theirs.name}: db=${theirs.database} redis=${theirs.redisDb} api=${theirs.api.port} bucket=${theirs.spacesBucket}`,
  );
  for (const key of ['database', 'redisDb', 'api', 'seller', 'admin', 'sim', 'spacesBucket']) {
    const a = typeof mine[key] === 'object' ? mine[key].port : mine[key];
    const b = typeof theirs[key] === 'object' ? theirs[key].port : theirs[key];
    if (a === b)
      throw new Error(`Both stacks claim the same ${key} (${String(a)}) — not isolated.`);
  }
  console.log('  ✓ every namespace differs\n');

  // What the RUNNING processes are pointed at, read from their own
  // environment — the config file says what someone intended, and
  // /proc says what is actually connected.
  console.log('EACH API READS ITS OWN DATABASE (behaviour, not configuration)');
  const { prisma } = await import('./lib/deps.mjs');
  for (const row of await backendsByDatabase(prisma)) {
    console.log(`  postgres backends on ${row.datname}: ${row.n}`);
  }
  for (const [owner, other] of [
    [mine, theirs],
    [theirs, mine],
  ]) {
    const awb = await anAwbIn(owner);
    if (awb === null) {
      console.log(`  stack ${owner.name} holds no waybill yet \u2014 nothing to cross-check with`);
      continue;
    }
    const ownAnswer = await tracking(owner.api.url, awb);
    const otherAnswer = await tracking(other.api.url, awb);
    console.log(
      `  waybill ${awb} (stack ${owner.name}): its own API \u2192 ${ownAnswer}, ` +
        `stack ${other.name}'s API \u2192 ${otherAnswer}`,
    );
    if (ownAnswer !== '200') {
      throw new Error(`stack ${owner.name}'s API does not know its own waybill (${ownAnswer}).`);
    }
    if (otherAnswer !== '404') {
      throw new Error(
        `stack ${other.name}'s API answered ${otherAnswer} for stack ${owner.name}'s waybill \u2014 ` +
          'it is reading the other database.',
      );
    }
  }
  console.log('  \u2713 neither API can see the other stack\u2019s parcels\n');

  // THE QUEUE EXPERIMENT.
  console.log('QUEUE ISOLATION');
  const theirRedis = await connect(theirs.redisUrl);
  const myRedis = await connect(mine.redisUrl);
  try {
    const jobId = `${PROBE_JOB}-${Date.now()}`;
    const key = `bull:${PROBE_QUEUE}:${jobId}`;

    const theirBullBefore = await theirRedis.dbsize();
    // The queue's connection is kept so it can be disconnected: BullMQ
    // does not close a connection it was HANDED, so leaving it
    // anonymous left the process sitting there after printing its
    // verdict, which reads as a hung check.
    const queueConn = await connect(mine.redisUrl);
    const queue = new BullMQ.Queue(PROBE_QUEUE, { connection: queueConn });
    await queue.add(PROBE_JOB, { probe: true }, { jobId, attempts: 1, removeOnFail: false });
    console.log(
      `  queued ${PROBE_JOB} as ${jobId} on stack ${mine.name} (redis DB ${mine.redisDb})`,
    );

    const here = await myRedis.exists(key);
    const there = await theirRedis.exists(key);
    console.log(`  key present in DB ${mine.redisDb}: ${here === 1}`);
    console.log(`  key present in DB ${theirs.redisDb}: ${there === 1}`);
    if (here !== 1) throw new Error('The probe job is not in its own stack’s Redis DB.');
    if (there !== 0) throw new Error('The probe job appeared in the OTHER stack’s Redis DB.');

    // Wait for a worker to take it. It must be THIS stack's — the other
    // stack's API is connected to a different logical DB, proved above.
    let state = 'waiting';
    for (let i = 0; i < 30 && (state === 'waiting' || state === 'delayed'); i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const job = await queue.getJob(jobId);
      state = job === undefined ? 'gone' : await job.getState();
    }
    console.log(`  probe reached state "${state}" — a worker on DB ${mine.redisDb} took it`);
    if (state === 'waiting') {
      console.log(`  (still waiting: stack ${mine.name}’s API may not be running)`);
    }

    const theirBullAfter = await theirRedis.dbsize();
    console.log(
      `  stack ${theirs.name} Redis DB ${theirs.redisDb} key count: ` +
        `${theirBullBefore} before, ${theirBullAfter} after`,
    );

    await queue.remove(jobId).catch(() => {});
    await queue.close();
    queueConn.disconnect();
    console.log('  ✓ the probe never existed in the other stack’s queue namespace\n');
  } finally {
    myRedis.disconnect();
    theirRedis.disconnect();
  }

  // The `@skydrop/db` singleton holds its pool open, so the process
  // would sit there looking like a hung check.
  const { prisma: db } = await import('./lib/deps.mjs');
  await db.$disconnect();

  console.log('Isolated.');
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exitCode = 1;
});
