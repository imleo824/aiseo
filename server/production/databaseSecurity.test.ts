import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { assertDatabaseSecurity, EXPECTED_MIGRATION_VERSION, inspectDatabaseSecurity } from './databaseSecurity';

const databaseWith = (role = 'app_backend', bypassRls = false, ownedTables = 0n, version = EXPECTED_MIGRATION_VERSION) => {
  const query = vi.fn()
    .mockResolvedValueOnce([{ role, bypass_rls: bypassRls }])
    .mockResolvedValueOnce([{ owned_tables: ownedTables }])
    .mockResolvedValueOnce(version ? [{ version }] : []);
  return { database: { $queryRaw: query } as unknown as PrismaClient, query };
};

describe('database runtime security preflight', () => {
  it('accepts the expected non-owner non-BYPASSRLS role at the exact migration', async () => {
    const { database } = databaseWith();
    await expect(assertDatabaseSecurity(database, 'app_backend')).resolves.toBeUndefined();
    await expect(inspectDatabaseSecurity(databaseWith('app_worker').database)).resolves.toMatchObject({ role: 'app_worker', bypassRls: false, ownedBusinessTables: 0 });
  });

  it('rejects a role mismatch, BYPASSRLS, table ownership and migration drift', async () => {
    await expect(assertDatabaseSecurity(databaseWith('postgres').database, 'app_backend')).rejects.toThrow('current_user=postgres');
    await expect(assertDatabaseSecurity(databaseWith('app_backend', true).database, 'app_backend')).rejects.toThrow('BYPASSRLS');
    await expect(assertDatabaseSecurity(databaseWith('app_worker', false, 1n).database, 'app_worker')).rejects.toThrow('must not own');
    await expect(assertDatabaseSecurity(databaseWith('app_worker', false, 0n, 'old').database, 'app_worker')).rejects.toThrow('does not match');
  });
});
