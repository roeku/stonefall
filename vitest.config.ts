import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `archive/` holds pre-pivot code kept verbatim as a record. It is excluded from tsconfig,
    // eslint and prettier for the same reason, and it contains an empty legacy test file that
    // vitest would otherwise report as a failure.
    // `tools/smoke.test.ts` talks to the local harness over HTTP and is run by hand while
    // `npm run play` is up: `npx vitest run tools/smoke.test.ts`.
    exclude: ['**/node_modules/**', '**/dist/**', 'archive/**', 'tools/**'],
  },
});
