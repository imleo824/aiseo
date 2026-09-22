import { describe, expect, it } from 'vitest';
import { parseIntegrationReturn, sanitizedIntegrationReturnUrl } from './integrationReturn';

const siteId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';

describe('integration return handling', () => {
  it('accepts a complete WordPress verification return', () => {
    expect(parseIntegrationReturn(`?wordpress=verifying&siteId=${siteId}&organizationId=${organizationId}`)).toEqual({
      integration: 'WORDPRESS', status: 'VERIFYING', siteId, organizationId
    });
  });

  it('rejects a malformed WordPress verification return', () => {
    expect(parseIntegrationReturn('?wordpress=verifying&siteId=bad&organizationId=bad')).toBeNull();
  });

  it('recognizes cancellation and GSC synchronization returns', () => {
    expect(parseIntegrationReturn('?wordpress=cancelled')).toEqual({ integration: 'WORDPRESS', status: 'CANCELLED' });
    expect(parseIntegrationReturn('?wordpress=failed')).toEqual({ integration: 'WORDPRESS', status: 'FAILED' });
    expect(parseIntegrationReturn('?gsc=syncing')).toEqual({ integration: 'GSC', status: 'SYNCING' });
  });

  it('removes integration parameters while preserving navigation and hash', () => {
    expect(sanitizedIntegrationReturnUrl(`https://app.example.com/?view=SITE_MANAGEMENT&wordpress=verifying&siteId=${siteId}&organizationId=${organizationId}#sites`))
      .toBe('/?view=SITE_MANAGEMENT#sites');
  });
});
