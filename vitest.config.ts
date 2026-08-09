import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `archive/` holds pre-pivot code kept verbatim as a record. It is excluded from tsconfig,
    // eslint and prettier for the same reason, and it contains an empty legacy test file that
    // vitest would otherwise report as a failure.
    exclude: ['**/node_modules/**', '**/dist/**', 'archive/**'],
  },
});
