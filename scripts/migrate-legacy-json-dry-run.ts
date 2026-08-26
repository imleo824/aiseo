import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

type LegacyTenant = {
  account?: { username?: string; email?: string; companyName?: string };
  sites?: unknown[];
  opportunities?: unknown[];
  drafts?: unknown[];
  creditTransactions?: unknown[];
  automatedTasks?: unknown[];
};

const inputPath = process.argv[2] || path.join(process.cwd(), 'tenant_db.json');
if (!existsSync(inputPath)) {
  console.error(JSON.stringify({ ok: false, message: 'Legacy JSON database was not found. Nothing was read or changed.', inputPath }));
  process.exit(2);
}

const bytes = readFileSync(inputPath);
const checksum = createHash('sha256').update(bytes).digest('hex');
const tenants = JSON.parse(bytes.toString('utf8')) as Record<string, LegacyTenant>;
const report = Object.entries(tenants).map(([legacyTenantId, tenant]) => ({
  legacyTenantId,
  organizationName: tenant.account?.companyName || tenant.account?.username || 'Unnamed organization',
  hasAccountIdentity: Boolean(tenant.account?.email || tenant.account?.username),
  sites: tenant.sites?.length || 0,
  opportunities: tenant.opportunities?.length || 0,
  drafts: tenant.drafts?.length || 0,
  creditTransactions: tenant.creditTransactions?.length || 0,
  automatedTasks: tenant.automatedTasks?.length || 0,
  excludedSecrets: ['passwordHash', 'wpAppPassword', 'baiduToken', 'googleServiceAccountJson', 'sessionTokens']
}));

console.log(JSON.stringify({
  ok: true,
  dryRun: true,
  inputPath,
  sha256: checksum,
  tenantCount: report.length,
  organizations: report,
  nextStep: 'Review this report, rotate credentials, then implement a separately approved one-time import against a backup Supabase project.'
}, null, 2));
