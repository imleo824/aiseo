import { randomUUID } from 'node:crypto';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, '');
};

const appBaseUrl = required('APP_BASE_URL');
const supabaseUrl = required('SUPABASE_URL');
const publishableKey = required('SUPABASE_PUBLISHABLE_KEY');
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
const email = `runtime-contract-${randomUUID()}@example.com`;
const password = `Ci-${randomUUID()}-Pass!`;

const readJson = async (response) => {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Expected JSON from ${response.url}, received ${text.slice(0, 200)}`); }
};

const expectStatus = async (response, expected, label) => {
  const payload = await readJson(response);
  const accepted = Array.isArray(expected) ? expected : [expected];
  if (!accepted.includes(response.status)) {
    throw new Error(`${label}: expected HTTP ${accepted.join(' or ')}, received ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
};

const api = (path, accessToken, init = {}) => fetch(`${appBaseUrl}/api/v1${path}`, {
  ...init,
  headers: {
    ...(init.body ? { 'content-type': 'application/json' } : {}),
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    ...init.headers
  }
});

await expectStatus(await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json'
  },
  body: JSON.stringify({ email, password, email_confirm: true })
}), [200, 201], 'create confirmed Auth user');

const signIn = await expectStatus(await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: publishableKey, 'content-type': 'application/json' },
  body: JSON.stringify({
    email,
    password,
    // The local Supabase project deliberately keeps CAPTCHA enabled. Its CI
    // secret is Cloudflare's official always-pass test secret, which only
    // accepts this documented dummy token.
    gotrue_meta_security: { captcha_token: 'XXXX.DUMMY.TOKEN.XXXX' }
  })
}), 200, 'sign in through Supabase Auth');
if (typeof signIn.access_token !== 'string' || !signIn.access_token) throw new Error('Supabase sign-in did not return an access token');
const token = signIn.access_token;

const malformed = await expectStatus(await fetch(`${appBaseUrl}/api/v1/me`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{invalid'
}), 400, 'malformed JSON boundary');
if (malformed.error?.code !== 'VALIDATION_FAILED' || !malformed.error?.traceId) throw new Error('Malformed JSON response does not follow the API error contract');

const unauthorized = await expectStatus(await api('/me'), 401, 'unauthenticated request');
if (unauthorized.error?.code !== 'UNAUTHORIZED' || !unauthorized.error?.traceId) throw new Error('Unauthorized response does not follow the API error contract');

const me = await expectStatus(await api('/me', token), 200, 'authenticated personal workspace bootstrap');
const organization = me.data?.organizations?.[0];
if (!me.data?.profile?.id || !organization?.id || organization.role !== 'OWNER') {
  throw new Error(`Personal workspace bootstrap returned an invalid contract: ${JSON.stringify(me)}`);
}
if ('erasureClaimedAt' in me.data.profile || 'updatedAt' in me.data.profile) {
  throw new Error('Personal workspace response exposed internal profile lifecycle fields');
}
if (organization.creditBalanceMicros !== '0') throw new Error('New personal workspaces must start with zero credit');

const pricing = await expectStatus(await api('/pricing', token), 200, 'read public customer pricing');
if (!Array.isArray(pricing.data?.packages) || !Array.isArray(pricing.data?.actions) || !pricing.data?.customPricing) {
  throw new Error(`Pricing endpoint returned an invalid contract: ${JSON.stringify(pricing)}`);
}
const organizations = await expectStatus(await api('/organizations', token), 200, 'list authorized organizations');
if (!Array.isArray(organizations.data) || organizations.data[0]?.id !== organization.id) throw new Error('Organization list does not match the personal workspace');
const members = await expectStatus(await api(`/organizations/${organization.id}/members`, token), 200, 'list organization members');
if (!Array.isArray(members.data) || members.data[0]?.profileId !== me.data.profile.id) throw new Error('Organization owner is missing from members endpoint');
const protectedOwner = await expectStatus(await api(`/organizations/${organization.id}/members`, token, {
  method: 'POST',
  headers: { 'idempotency-key': randomUUID() },
  body: JSON.stringify({ profileId: me.data.profile.id, role: 'ADMIN' })
}), 409, 'protect organization owner role');
if (protectedOwner.error?.code !== 'RESOURCE_CONFLICT') throw new Error('Organization owner role could be modified through member management');

const foreignOrganizationId = randomUUID();
const forbidden = await expectStatus(await api(`/organizations/${foreignOrganizationId}/sites`, token), 403, 'cross-organization request');
if (forbidden.error?.code !== 'FORBIDDEN') throw new Error('Cross-organization request was not rejected by the authorization boundary');

const idempotencyKey = randomUUID();
const siteBody = JSON.stringify({ name: 'Runtime Contract Site', domain: 'example.com', language: 'en-US' });
const createSite = () => api(`/organizations/${organization.id}/sites`, token, {
  method: 'POST',
  headers: { 'idempotency-key': idempotencyKey },
  body: siteBody
});
const created = await expectStatus(await createSite(), 201, 'create site');
const replayed = await expectStatus(await createSite(), 201, 'replay idempotent site creation');
if (!created.data?.site?.id || replayed.data?.site?.id !== created.data.site.id) throw new Error('Idempotent write did not replay the committed response');
const siteId = created.data.site.id;

const missingIdempotency = await expectStatus(await api(`/organizations/${organization.id}/sites`, token, {
  method: 'POST',
  body: siteBody
}), 400, 'reject write without idempotency key');
if (missingIdempotency.error?.code !== 'VALIDATION_FAILED') throw new Error('Missing idempotency key did not return a validation error');

const unknownSiteField = await expectStatus(await api(`/organizations/${organization.id}/sites`, token, {
  method: 'POST',
  headers: { 'idempotency-key': randomUUID() },
  body: JSON.stringify({ name: 'Invalid Site', domain: 'invalid.example.com', language: 'en-US', unexpected: true })
}), 400, 'reject unknown site input fields');
if (unknownSiteField.error?.code !== 'VALIDATION_FAILED') throw new Error('Unknown site input was not rejected');

const invalidPagination = await expectStatus(await api(`/organizations/${organization.id}/sites?limit=1.5`, token), 400, 'reject non-integer pagination');
if (invalidPagination.error?.code !== 'VALIDATION_FAILED') throw new Error('Invalid pagination did not return a validation error');

const sites = await expectStatus(await api(`/organizations/${organization.id}/sites?limit=100`, token), 200, 'list sites');
if (!Array.isArray(sites.data) || sites.data[0]?.id !== siteId) throw new Error('Created site is missing from site listing');

const updateKey = randomUUID();
const updateSite = () => api(`/organizations/${organization.id}/sites/${siteId}`, token, {
  method: 'PUT',
  headers: { 'idempotency-key': updateKey },
  body: JSON.stringify({ name: 'Runtime Contract Site Updated' })
});
const updated = await expectStatus(await updateSite(), 200, 'update site');
const updateReplay = await expectStatus(await updateSite(), 200, 'replay idempotent site update');
if (updated.data?.site?.name !== 'Runtime Contract Site Updated' || updateReplay.data?.site?.id !== siteId) throw new Error('Site update contract or replay is invalid');
for (const responseSite of [created.data.site, replayed.data.site, updated.data.site, updateReplay.data.site]) {
  if ('wordpressCredentials' in responseSite || 'wordpressCredentialKeyVersion' in responseSite || 'latestWordpressCompatibilityProfileId' in responseSite) {
    throw new Error('Site mutation response exposed private WordPress credential metadata');
  }
}

const compatibility = await expectStatus(await api(`/organizations/${organization.id}/sites/${siteId}/wordpress/compatibility`, token), 200, 'read WordPress compatibility state');
if (compatibility.data?.mode !== 'RECHECK_REQUIRED') throw new Error('New site must require a WordPress compatibility check');
const capabilities = await expectStatus(await api(`/organizations/${organization.id}/sites/${siteId}/wordpress/action-capabilities`, token), 200, 'read WordPress action capabilities');
if (capabilities.data?.mode !== 'RECHECK_REQUIRED' || !Array.isArray(capabilities.data?.blockReasons)) throw new Error('WordPress capability fallback is invalid');

await expectStatus(await api(`/organizations/${organization.id}/sites/${siteId}/test-connection`, token, {
  method: 'POST', headers: { 'idempotency-key': randomUUID() }, body: '{}'
}), 400, 'fail closed when WordPress credentials are absent');
await expectStatus(await api(`/organizations/${organization.id}/sites/${siteId}/wordpress/recheck`, token, {
  method: 'POST', headers: { 'idempotency-key': randomUUID() }, body: '{}'
}), 400, 'fail closed when WordPress compatibility credentials are absent');

const end = new Date(Date.now() - 3 * 86_400_000);
const start = new Date(end.getTime() - 27 * 86_400_000);
const date = (value) => value.toISOString().slice(0, 10);
await expectStatus(await api(`/organizations/${organization.id}/sites/${siteId}/gsc/sync`, token, {
  method: 'POST',
  headers: { 'idempotency-key': randomUUID() },
  body: JSON.stringify({ startDate: date(start), endDate: date(end) })
}), 409, 'fail closed when GSC is not connected');
await expectStatus(await api(`/organizations/${organization.id}/sites/${randomUUID()}/gsc`, token, {
  method: 'DELETE', headers: { 'idempotency-key': randomUUID() }
}), 404, 'reject GSC disconnect for an unknown site');

const growthInputValidation = await expectStatus(await api(`/organizations/${organization.id}/sites/${siteId}/growth-programs`, token, {
  method: 'POST',
  headers: { 'idempotency-key': randomUUID() },
  body: JSON.stringify({ mode: 'ONCE', inputs: [{ type: 'KEYWORD', value: 'runtime seo', unexpected: true }] })
}), 400, 'reject unknown growth input fields');
if (growthInputValidation.error?.code !== 'VALIDATION_FAILED') throw new Error('Unknown growth input was not rejected');

const readContracts = [
  [`/organizations/${organization.id}/sites/${siteId}/growth-programs`, 'site growth programs'],
  [`/organizations/${organization.id}/growth-programs`, 'organization growth programs'],
  [`/organizations/${organization.id}/growth-statuses`, 'growth status collection'],
  [`/organizations/${organization.id}/opportunities`, 'opportunities'],
  [`/organizations/${organization.id}/jobs`, 'jobs'],
  [`/organizations/${organization.id}/drafts`, 'drafts'],
  [`/organizations/${organization.id}/audit-events`, 'audit events'],
  [`/organizations/${organization.id}/payment-intents`, 'payment intents']
];
for (const [path, label] of readContracts) {
  const result = await expectStatus(await api(`${path}?limit=100`, token), 200, `read ${label}`);
  if (!Array.isArray(result.data)) throw new Error(`${label} endpoint did not return a collection`);
}
const growthStatus = await expectStatus(await api(`/organizations/${organization.id}/sites/${siteId}/growth-status`, token), 200, 'read site growth status');
if (!Array.isArray(growthStatus.data?.stages) || !growthStatus.data?.wordpressCompatibility) throw new Error('Site growth status contract is invalid');
const metrics = await expectStatus(await api(`/organizations/${organization.id}/metrics`, token), 200, 'read organization metrics');
if (metrics.data?.source !== 'POSTGRES' || metrics.data?.sites !== 1) throw new Error('Organization metrics contract is invalid');
const ledger = await expectStatus(await api(`/organizations/${organization.id}/ledger?limit=100`, token), 200, 'read immutable ledger');
if (ledger.data?.balanceMicros !== '0' || ledger.data?.availableMicros !== '0' || !Array.isArray(ledger.data?.entries)) throw new Error('Ledger contract is invalid');

await expectStatus(await api(`/organizations/${organization.id}/sites/${siteId}/site-snapshots/latest`, token), 404, 'missing site snapshot');
await expectStatus(await api(`/organizations/${organization.id}/growth-programs/${randomUUID()}`, token), 404, 'missing growth program');
await expectStatus(await api(`/organizations/${organization.id}/growth-runs/${randomUUID()}`, token), 404, 'missing growth run');
await expectStatus(await api(`/organizations/${organization.id}/jobs/${randomUUID()}`, token), 404, 'missing job');
await expectStatus(await api('/admin/provider-status', token), 403, 'non-admin provider status boundary');

const exported = await expectStatus(await api('/me/export', token), 200, 'export personal data');
if (exported.data?.schemaVersion !== 'personal-data-export-1' || exported.data?.profile?.email !== email) {
  throw new Error(`Personal data export returned an invalid contract: ${JSON.stringify(exported)}`);
}

const deleteSiteKey = randomUUID();
const deleteSite = () => api(`/organizations/${organization.id}/sites/${siteId}`, token, {
  method: 'DELETE', headers: { 'idempotency-key': deleteSiteKey }
});
const deletedSite = await expectStatus(await deleteSite(), 200, 'delete empty site');
const deleteReplay = await expectStatus(await deleteSite(), 200, 'replay idempotent site deletion');
if (deletedSite.data?.deletedId !== siteId || deleteReplay.data?.deletedId !== siteId) throw new Error('Site deletion contract or replay is invalid');

const deletionKey = randomUUID();
const deletion = await expectStatus(await api('/me', token, {
  method: 'DELETE',
  headers: { 'idempotency-key': deletionKey },
  body: JSON.stringify({ confirmEmail: email })
}), 202, 'request account deletion');
if (!deletion.data?.deletionRequested || !deletion.data?.sessionsRevoked || !deletion.data?.purgeAfter) {
  throw new Error(`Account deletion returned an invalid contract: ${JSON.stringify(deletion)}`);
}

const revoked = await expectStatus(await api('/me/export', token), 401, 'revoked sensitive session');
if (revoked.error?.code !== 'UNAUTHORIZED') throw new Error('Revoked session was accepted by a sensitive endpoint');

console.log('Runtime contract passed: Auth, workspace bootstrap, owner protection, RLS isolation, strict validation, pagination, site lifecycle, WordPress/GSC fail-closed behavior, growth reads, metrics, ledger, admin boundary, idempotency, export and account deletion');
