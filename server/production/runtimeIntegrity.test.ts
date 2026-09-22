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
});
