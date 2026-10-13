import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test/unit'],
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!**/*.module.ts',
    '!**/dto/**',
    '!**/*.d.ts',
  ],
  coverageDirectory: 'coverage',

  // RECYCLE A WORKER THAT HAS GROWN TOO BIG.
  //
  // This suite is 472 files and ~7,600 tests, and a jest worker keeps
  // every module registry it has touched. Across that many suites — each
  // importing a slice of a Nest application, a Prisma client and a fake
  // ledger — a single worker walks past Node's default ~2 GB old-space
  // and the run dies with "Ineffective mark-compacts near heap limit",
  // exit 134. That is not a failing test: it is the runner giving up,
  // and it reports as a red build with no assertion to look at.
  //
  // It happened on CI on 2026-10-13 against a commit that touched only
  // `infra/` — no workspace code, no new tests — forty minutes after the
  // identical suite passed. So the suite now sits ON the ceiling and
  // tips over at random, which is worse than failing honestly: a red run
  // that means nothing teaches people to re-run rather than look.
  //
  // `workerIdleMemoryLimit` restarts a worker once it exceeds this,
  // between test files, so memory cannot accumulate across the whole
  // run. 512 MB is well under the default heap and well over what any
  // single suite here needs, so a restart costs a module re-resolve and
  // nothing else.
  //
  // Deliberately in the jest config rather than only in CI: the same
  // ceiling kills a full local run, which is how the suite came to be
  // run in slices on this machine.
  workerIdleMemoryLimit: '512MB',
};

export default config;
