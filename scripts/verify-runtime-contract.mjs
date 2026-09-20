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
if (organization.creditBalanceMicros !== '0') throw new Error('New personal workspaces must start with zero credit');

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

const exported = await expectStatus(await api('/me/export', token), 200, 'export personal data');
if (exported.data?.schemaVersion !== 'personal-data-export-1' || exported.data?.profile?.email !== email) {
  throw new Error(`Personal data export returned an invalid contract: ${JSON.stringify(exported)}`);
}

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

console.log('Runtime contract passed: Auth, workspace bootstrap, RLS isolation, API errors, idempotent writes, export and account deletion');
