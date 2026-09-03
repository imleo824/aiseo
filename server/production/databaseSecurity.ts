import type { PrismaClient } from '@prisma/client';

export const EXPECTED_MIGRATION_VERSION = '20260903052545';

export type DatabaseSecurityStatus = {
  role: string;
  bypassRls: boolean;
  ownedBusinessTables: number;
  migrationVersion?: string;
};

export const inspectDatabaseSecurity = async (database: PrismaClient): Promise<DatabaseSecurityStatus> => {
  const [roles, owners, migrations] = await Promise.all([
    database.$queryRaw<Array<{ role: string; bypass_rls: boolean }>>`
      SELECT current_user::text AS role, rolbypassrls AS bypass_rls
      FROM pg_roles WHERE rolname = current_user
    `,
    database.$queryRaw<Array<{ owned_tables: bigint }>>`
      SELECT count(*)::bigint AS owned_tables
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r'
        AND pg_get_userbyid(relation.relowner) = current_user
    `,
    database.$queryRaw<Array<{ version: string }>>`
      SELECT version FROM supabase_migrations.schema_migrations
      ORDER BY version DESC LIMIT 1
    `
  ]);
  if (!roles[0]) throw new Error('Database runtime role was not found in pg_roles');
  return {
    role: roles[0].role,
    bypassRls: roles[0].bypass_rls,
    ownedBusinessTables: Number(owners[0]?.owned_tables || 0n),
    migrationVersion: migrations[0]?.version
  };
};

export const assertDatabaseSecurity = async (database: PrismaClient, expectedRole: 'app_backend' | 'app_worker'): Promise<void> => {
  const status = await inspectDatabaseSecurity(database);
  if (status.role !== expectedRole) throw new Error(`Database resolved current_user=${status.role}; expected ${expectedRole}`);
  if (status.bypassRls) throw new Error(`${expectedRole} unexpectedly has BYPASSRLS`);
  if (status.ownedBusinessTables > 0) throw new Error(`${expectedRole} must not own business tables`);
  if (status.migrationVersion !== EXPECTED_MIGRATION_VERSION) {
    throw new Error(`Database migration ${status.migrationVersion || 'missing'} does not match ${EXPECTED_MIGRATION_VERSION}`);
  }
};
