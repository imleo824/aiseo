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
  if (!authorization || !url || !serviceRole) return json({ error: 'misconfigured' }, 500);

  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const token = authorization.replace(/^Bearer\s+/i, '');
  const { data: identity, error: identityError } = await admin.auth.getUser(token);
  if (identityError || !identity.user) return json({ error: 'unauthorized' }, 401);

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('deletion_requested_at')
    .eq('id', identity.user.id)
    .maybeSingle();
  if (profileError) return json({ error: 'profile_check_failed' }, 500);
  if (!profile?.deletion_requested_at) return json({ error: 'deletion_not_requested' }, 409);

  const { error: deletionError } = await admin.auth.admin.deleteUser(identity.user.id, false);
  if (deletionError) return json({ error: 'auth_deletion_failed' }, 502);
  return json({ data: { erased: true } });
});
