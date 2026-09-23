import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

describe('production runtime integrity', () => {
  it('contains no demo authentication bypass', () => {
    const auth = source('./auth.ts');
    expect(auth).not.toContain('demo-access-token');
    expect(auth).not.toContain('demo-user');
    expect(auth).toContain('.auth.getUser(token)');
  });

  it('requires the real database and Redis adapters', () => {
    const prisma = source('./prisma.ts');
    const queue = source('./queue.ts');
    expect(prisma).not.toContain('mockDatabase');
    expect(prisma).not.toContain('createMockDatabase');
    expect(queue).not.toContain('MockRedis');
    expect(queue).not.toContain('MockQueue');
    expect(queue).toContain('new IORedis(requireRedisUrl()');
  });

  it('keeps the public readiness response minimal and separately rate limited', () => {
    const app = source('./app.ts');
    const readyStart = app.indexOf("app.use('/api/health/ready'");
    const readyEnd = app.indexOf("app.use('/api/v1'", readyStart);
    const readyRoute = app.slice(readyStart, readyEnd);

    expect(readyStart).toBeGreaterThanOrEqual(0);
    expect(readyRoute).toContain("createRateLimiter(60_000, 60, 'readiness')");
    expect(readyRoute).not.toContain('detail:');
    expect(readyRoute).not.toContain('migrationVersion');
    expect(readyRoute).not.toContain('ownedBusinessTables=');
  });

  it('limits account export to the current profile and excludes organization payloads', () => {
    const apiRouter = source('./apiRouter.ts');
    const exportStart = apiRouter.indexOf("apiRouter.get('/me/export'");
    const exportEnd = apiRouter.indexOf("apiRouter.delete('/me'", exportStart);
    const exportRoute = apiRouter.slice(exportStart, exportEnd);

    expect(exportStart).toBeGreaterThanOrEqual(0);
    expect(exportEnd).toBeGreaterThan(exportStart);
    expect(exportRoute).toContain("scope: 'CURRENT_PROFILE_ONLY'");
    expect(exportRoute).not.toContain('tx.site.findMany');
    expect(exportRoute).not.toContain('request.authUser');
    expect(exportRoute).not.toContain('contentBlob');
  });

  it('stores WordPress authorization before remote verification and clears the callback URL', () => {
    const apiRouter = source('./apiRouter.ts');
    const callbackStart = apiRouter.indexOf("apiRouter.get('/integrations/wordpress/callback'");
    const callbackEnd = apiRouter.indexOf('apiRouter.use(requireAuth)', callbackStart);
    const callbackRoute = apiRouter.slice(callbackStart, callbackEnd);

    expect(callbackStart).toBeGreaterThanOrEqual(0);
    expect(callbackEnd).toBeGreaterThan(callbackStart);
    expect(callbackRoute).toContain('wordpressCredentials: encrypted');
    expect(callbackRoute).toContain('wordpressStatus: SiteConnectionStatus.VERIFYING');
    expect(callbackRoute).toContain('response.redirect(303');
    expect(callbackRoute).not.toContain('wordPressService.testConnection');
    expect(callbackRoute).not.toContain('scanWordPressCompatibility');
  });

  it('returns failed GSC callbacks to the application and protects authorization as sensitive', () => {
    const apiRouter = source('./apiRouter.ts');
    const callbackStart = apiRouter.indexOf("apiRouter.get('/integrations/gsc/callback'");
    const callbackEnd = apiRouter.indexOf("apiRouter.get('/integrations/wordpress/callback'", callbackStart);
    const callbackRoute = apiRouter.slice(callbackStart, callbackEnd);
    const authorizeStart = apiRouter.indexOf("apiRouter.post('/organizations/:organizationId/sites/:siteId/gsc/authorize'");
    const authorizeEnd = apiRouter.indexOf("apiRouter.post('/organizations/:organizationId/sites/:siteId/gsc/sync'", authorizeStart);
    const authorizeRoute = apiRouter.slice(authorizeStart, authorizeEnd);

    expect(callbackStart).toBeGreaterThanOrEqual(0);
    expect(callbackRoute).toContain('GSC_AUTH_CALLBACK');
    expect(callbackRoute).toContain('gsc=failed');
    expect(callbackRoute).toContain('OrganizationRole.ADMIN');
    expect(authorizeRoute).toContain('await revalidateSensitiveSession(request)');
    expect(authorizeRoute).toContain('OrganizationRole.ADMIN');
  });

  it('queues manual GSC synchronization only for a connected property', () => {
    const apiRouter = source('./apiRouter.ts');
    const syncStart = apiRouter.indexOf("apiRouter.post('/organizations/:organizationId/sites/:siteId/gsc/sync'");
    const syncEnd = apiRouter.indexOf("apiRouter.delete('/organizations/:organizationId/sites/:siteId/gsc'", syncStart);
    const syncRoute = apiRouter.slice(syncStart, syncEnd);

    expect(syncStart).toBeGreaterThanOrEqual(0);
    expect(syncRoute).toContain('organizationId: orgId');
    expect(syncRoute).toContain('status: SiteConnectionStatus.CONNECTED');
    expect(syncRoute).toContain('propertyId: { not: null }');
  });

  it('protects ownership and billing administration boundaries', () => {
    const apiRouter = source('./apiRouter.ts');
    const membersStart = apiRouter.indexOf("apiRouter.post('/organizations/:organizationId/members'");
    const membersEnd = apiRouter.indexOf("apiRouter.get('/organizations/:organizationId/sites'", membersStart);
    const membersRoute = apiRouter.slice(membersStart, membersEnd);
    const paymentsStart = apiRouter.indexOf("apiRouter.post('/organizations/:organizationId/payment-intents'");
    const paymentsEnd = apiRouter.indexOf("apiRouter.get('/organizations/:organizationId/ledger'", paymentsStart);
    const paymentsRoutes = apiRouter.slice(paymentsStart, paymentsEnd);

    expect(membersRoute).toContain('existing?.role === OrganizationRole.OWNER');
    expect(membersRoute).toContain('ConflictError');
    expect(paymentsRoutes.match(/OrganizationRole\.ADMIN/g)).toHaveLength(2);
    expect(paymentsRoutes).not.toContain('OrganizationRole.EDITOR');
  });

  it('fails rollback before queueing when WordPress is disconnected', () => {
    const apiRouter = source('./apiRouter.ts');
    const rollbackStart = apiRouter.indexOf("apiRouter.post('/organizations/:organizationId/drafts/:draftId/rollback'");
    const rollbackEnd = apiRouter.indexOf("apiRouter.get('/organizations/:organizationId/audit-events'", rollbackStart);
    const rollbackRoute = apiRouter.slice(rollbackStart, rollbackEnd);

    expect(rollbackRoute).toContain('include: { site: true');
    expect(rollbackRoute).toContain('draft.site.wordpressStatus !== SiteConnectionStatus.CONNECTED');
    expect(rollbackRoute.indexOf('WordPress \u8fde\u63a5\u4e0d\u53ef\u7528')).toBeLessThan(rollbackRoute.indexOf('jobService.create'));
  });
});
