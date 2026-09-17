import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15000,
    // Integration tests share one live Postgres instance (via a module-level `pool`).
    // Running test files in parallel workers lets one file's TRUNCATE (resetDb) race
    // against another file's in-flight transactions/row locks, producing spurious
    // Postgres deadlocks that have nothing to do with application logic. Force test
    // files to run one at a time so the shared DB state stays consistent.
    fileParallelism: false,
  },
});
