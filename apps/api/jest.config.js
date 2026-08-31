/**
 * Jest configuration.
 *
 * Authority: docs/architecture/TESTING-ARCHITECTURE.md §10 — "Runner: Jest —
 * the NestJS default; @nestjs/testing assumes it."
 *
 * Deliberately minimal. There is no coverage threshold, no reporter, no module
 * name mapper, no setup file and no `@nestjs/testing` dependency: Phase 2.5
 * runs one infrastructure suite, and configuration for suites that do not
 * exist yet would be guesswork frozen into a config file.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],

  // ts-jest compiles with the project tsconfig, so `emitDecoratorMetadata` is
  // honoured (Nest DI needs it) and a type error fails the run.
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },

  /**
   * One worker. Every suite that touches MongoDB shares a single server, and
   * parallel workers would interleave against it. Run isolation is by `runId`,
   * not by process, so this is about keeping evidence legible rather than
   * about correctness.
   */
  maxWorkers: 1,

  /**
   * Generous because the first assertion has to wait for a real connection.
   * `retryAttempts: 0` in DatabaseModule means an unreachable database fails
   * in ~32s — the timeout must exceed that so the failure reported is
   * "cannot connect", not "timed out".
   */
  testTimeout: 60_000,
};
