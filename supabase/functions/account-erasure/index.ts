import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authorization = request.headers.get('authorization');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) return json({ error: 'misconfigured' }, 500);
  if (authorization !== `Bearer ${serviceRole}`) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data: claimed, error: claimError } = await admin.rpc('claim_due_account_erasures', { max_count: 50 });
  if (claimError) return json({ error: 'erasure_claim_failed' }, 500);

  let erased = 0;
  let failed = 0;
  for (const row of Array.isArray(claimed) ? claimed : []) {
    const profileId = typeof row?.profile_id === 'string' ? row.profile_id : '';
    if (!profileId) continue;
    const { error } = await admin.auth.admin.deleteUser(profileId, false);
    if (error && !/not found/i.test(error.message)) failed += 1;
    else erased += 1;
  }
  return json({ data: { claimed: Array.isArray(claimed) ? claimed.length : 0, erased, failed } }, failed ? 207 : 200);
});
