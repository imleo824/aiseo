const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IntegrationReturn =
  | { integration: 'WORDPRESS'; status: 'VERIFYING'; siteId: string; organizationId: string }
  | { integration: 'WORDPRESS'; status: 'CANCELLED'; siteId?: string; organizationId?: string }
  | { integration: 'WORDPRESS'; status: 'FAILED' }
  | { integration: 'GSC'; status: 'SYNCING' };

export const parseIntegrationReturn = (search: string): IntegrationReturn | null => {
  const params = new URLSearchParams(search);
  const wordpress = params.get('wordpress');
  if (wordpress === 'verifying') {
    const siteId = params.get('siteId') || '';
    const organizationId = params.get('organizationId') || '';
    if (!UUID_PATTERN.test(siteId) || !UUID_PATTERN.test(organizationId)) return null;
    return { integration: 'WORDPRESS', status: 'VERIFYING', siteId, organizationId };
  }
  if (wordpress === 'cancelled') {
    const siteId = params.get('siteId') || undefined;
    const organizationId = params.get('organizationId') || undefined;
    return {
      integration: 'WORDPRESS',
      status: 'CANCELLED',
      ...(siteId && UUID_PATTERN.test(siteId) ? { siteId } : {}),
      ...(organizationId && UUID_PATTERN.test(organizationId) ? { organizationId } : {})
    };
  }
  if (wordpress === 'failed') return { integration: 'WORDPRESS', status: 'FAILED' };
  if (params.get('gsc') === 'syncing') return { integration: 'GSC', status: 'SYNCING' };
  return null;
};

export const sanitizedIntegrationReturnUrl = (href: string): string => {
  const url = new URL(href);
  for (const key of ['wordpress', 'gsc', 'siteId', 'organizationId']) url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
};
