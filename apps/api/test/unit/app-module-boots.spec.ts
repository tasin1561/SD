/**
 * The application's dependency graph resolves.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * On 2026-08-06 the Phase 3/4 build shipped a service that was never
 * registered in its module. Typecheck passed — the import resolved and
 * the types were right. Lint passed. All 1796 unit tests passed, because
 * every one of them constructs its subject with `new Service(mock, mock)`
 * and never asks Nest to wire anything.
 *
 * CI caught it, in the two jobs that actually START the app:
 *
 *   UnknownDependenciesException: Nest can't resolve dependencies of the
 *   CourierOutboxDispatcherService (CourierOutboxService, ?).
 *
 * The app could not boot. Nothing before those jobs could have known,
 * and `pnpm gate` — typecheck, lint, format, unit — is by construction
 * blind to it: none of those four ever builds the container.
 *
 * So this test builds it. It needs no database and no Redis (nothing is
 * initialised — `compile()` resolves providers, it does not run
 * `onModuleInit`), which is what makes it cheap enough to belong in the
 * unit suite rather than in e2e where the feedback is fifteen minutes
 * away.
 *
 * ── IT SETS ITS OWN ENV, AND THAT IS DELIBERATE ───────────────────────
 * `AppModule` validates the environment at IMPORT time — `ConfigModule
 * .forRoot()` runs at module scope, so a missing var throws before any
 * test body executes. The first version of this file relied on the
 * ambient environment, passed locally off a developer `.env`, and failed
 * in CI on `JWT_SIGNING_KEY: Required`.
 *
 * **Does compiling the container GENUINELY need this env? Yes.** Not an
 * accident of coupling: `ConfigModule` calls
 * `NestConfigModule.forRoot({ validate })` inside its `@Module` decorator
 * argument, so validation runs when the file is IMPORTED, and the
 * `EnvService` factory validates `process.env` again when the provider
 * resolves. The app is designed to refuse to construct on a bad
 * environment — fail-fast on misconfiguration is the feature. There is
 * therefore no way to build this container without a valid env, and this
 * test is not reaching for configuration it does not need.
 *
 * Which means CI supplying the vars would ALSO have been correct. The
 * reason they live here instead is portability: a load-bearing boot check
 * should run in a fresh clone, in a new CI job, on a machine with no
 * `.env`, without anyone first discovering which vars it wants. `??=`
 * keeps that honest — a real environment's values always win, so this
 * cannot mask a genuine misconfiguration where the vars are set for
 * real.
 *
 * ── WHAT IT CATCHES, AND WHAT IT DOES NOT ────────────────────────────
 * Catches: a provider missing from `providers`, a service missing from
 * another module's `exports`, a circular module dependency, a token that
 * cannot be resolved. All of which are invisible to every other gate.
 *
 * Does NOT catch: anything about runtime behaviour. A module that
 * resolves can still be wrong. This is a boot check, not a smoke test.
 *
 * ── HOW IT FAILS, WHICH IS NOT HOW YOU EXPECT ────────────────────────
 * Nest's exception zone calls `process.exit(1)` on an unresolvable
 * dependency. Under jest that does NOT surface as a clean assertion
 * failure: the run hangs or dies, and CI reported it as
 * `process.exit called with "1"` rather than a named test. So a red here
 * looks like a stuck suite. Read the output for
 * `UnknownDependenciesException` — it names the service and the
 * unresolvable argument, which is the line worth having.
 */

/**
 * Minimum env for the schema to validate. Applied before the dynamic
 * import below, because validation runs at module scope.
 *
 * Only ever DEFAULTS: an ambient value wins, so this cannot mask a real
 * misconfiguration in an environment that sets these for real.
 */
const BOOT_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://skydrop:skydrop@localhost:5432/skydrop_test?schema=public',
  REDIS_URL: 'redis://localhost:6379/1',
  // 32-char minimum per the schema. Obviously throwaway, and never used:
  // compile() resolves providers, it does not sign anything.
  JWT_SIGNING_KEY: 'boot-check-signing-key-not-a-secret',
  SELLER_APP_URL: 'https://app.example.test',
  ADMIN_APP_URL: 'https://admin.example.test',
};

for (const [k, v] of Object.entries(BOOT_ENV)) {
  process.env[k] ??= v;
}

describe('AppModule', () => {
  it('resolves every provider — the app can actually start', async () => {
    // Dynamic imports so BOOT_ENV is in place first. A static import
    // would run ConfigModule.forRoot() during module load, before the
    // assignment above has any chance to apply.
    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../../src/app.module');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  }, 60_000);
});

describe('PortalWorkerRootModule', () => {
  it('resolves every provider — the portal worker can actually start', async () => {
    // AppModule deliberately cannot reach the portal, so the test above
    // says NOTHING about this graph. Without this, the portal worker would
    // be the one part of the system with no DI check — the exact shape of
    // the defect CI caught on 2026-08-06, in the exact place the isolation
    // rule guarantees no other gate will look.
    //
    // Importing the entry module does NOT start a browser: Chromium is
    // launched lazily inside PortalSessionService, and compile() never
    // runs onModuleInit.
    const { Test } = await import('@nestjs/testing');
    const { PortalWorkerRootModule } = await import('../../src/portal-worker-main');

    const moduleRef = await Test.createTestingModule({
      imports: [PortalWorkerRootModule],
    }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  }, 60_000);
});
