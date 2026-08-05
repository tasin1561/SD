import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

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
describe('AppModule', () => {
  it('resolves every provider — the app can actually start', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
    // A failure here reads as an UnknownDependenciesException naming the
    // service and the unresolvable argument index — which is the whole
    // value: it tells you the file to open.
  }, 60_000);
});
