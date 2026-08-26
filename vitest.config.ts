import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      exclude: ['src/**', 'server/mockData.ts', 'server/infrastructure/persistence/fileTenantRepository.ts'],
      thresholds: {
        statements: 80,
        lines: 80,
        functions: 80
      }
    }
  },
});
