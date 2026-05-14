import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test/e2e'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  globalSetup: '<rootDir>/test/e2e/global-setup.ts',
  globalTeardown: '<rootDir>/test/e2e/global-teardown.ts',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testTimeout: 60000,
  // Run files sequentially — they share the same DB; the harness wipes
  // auth state between tests, but two suites racing on the same DB would
  // be brittle.
  maxWorkers: 1,
  // BullMQ + ioredis open long-lived connections; we close them in the
  // app.close() hook but Node may still hold internal handles. forceExit
  // ends the jest worker promptly after the run.
  forceExit: true,
};

export default config;
