import type { PrismaClient } from '@prisma/client';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { assertDatabaseSecurity, EXPECTED_MIGRATION_VERSION, inspectDatabaseSecurity } from './databaseSecurity';

const databaseWith = (
  role = 'app_backend',
  bypassRls = false,
  ownedTables = 0n,
  version = EXPECTED_MIGRATION_VERSION,
  requiredMigrationPresent = version === EXPECTED_MIGRATION_VERSION
) => {
  const query = vi.fn()
    .mockResolvedValueOnce([{ role, bypass_rls: bypassRls }])
    .mockResolvedValueOnce([{ owned_tables: ownedTables }])
    .mockResolvedValueOnce([{ version: version || null, required_present: requiredMigrationPresent }]);
  return { database: { $queryRaw: query } as unknown as PrismaClient, query };
};

describe('database runtime security preflight', () => {
  it('pins runtime readiness to the newest committed Supabase migration', () => {
    const latest = readdirSync(resolve(process.cwd(), 'supabase/migrations'))
      .map((filename) => filename.match(/^(\d{14})_/)?.[1])
      .filter((version): version is string => Boolean(version))
      .sort()
      .at(-1);
    expect(EXPECTED_MIGRATION_VERSION).toBe(latest);
  });

  it('accepts the expected non-owner non-BYPASSRLS role when the required migration is present', async () => {
    const { database } = databaseWith();
    await expect(assertDatabaseSecurity(database, 'app_backend')).resolves.toBeUndefined();
    await expect(inspectDatabaseSecurity(databaseWith('app_worker').database)).resolves.toMatchObject({ role: 'app_worker', bypassRls: false, ownedBusinessTables: 0 });
    await expect(assertDatabaseSecurity(databaseWith('app_worker', false, 0n, '20270101000000', true).database, 'app_worker')).resolves.toBeUndefined();
  });

  it('rejects a role mismatch, BYPASSRLS, table ownership and migration drift', async () => {
    await expect(assertDatabaseSecurity(databaseWith('postgres').database, 'app_backend')).rejects.toThrow('current_user=postgres');
    await expect(assertDatabaseSecurity(databaseWith('app_backend', true).database, 'app_backend')).rejects.toThrow('BYPASSRLS');
    await expect(assertDatabaseSecurity(databaseWith('app_worker', false, 1n).database, 'app_worker')).rejects.toThrow('must not own');
    await expect(assertDatabaseSecurity(databaseWith('app_worker', false, 0n, 'old', false).database, 'app_worker')).rejects.toThrow('is not applied');
  });
});
