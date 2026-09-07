import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // The unit-coverage gate measures deterministic business/security code.
      // Express/Worker orchestration and live provider adapters are exercised
      // by the database, container, contract and Playwright CI gates.
      include: [
        'server/domain/errors.ts',
        'server/utils/logger.ts',
        'server/utils/networkSafety.ts',
        'server/production/crypto.ts',
        'server/production/databaseSecurity.ts',
        'server/production/env.ts',
        'server/production/growthDiscovery.ts',
        'server/production/growthMeasurement.ts',
        'server/production/growthPolicy.ts',
        'server/production/gscData.ts',
        'server/production/idempotency.ts',
        'server/production/publicRuntimeConfig.ts',
        'server/production/publishingPolicy.ts',
        'server/production/seoMarket.ts',
        'server/production/seoPipeline.ts',
        'server/production/sourceFetcher.ts'
      ],
      thresholds: {
        statements: 80,
        lines: 80,
        functions: 80
      }
    }
  },
});
