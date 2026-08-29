import { createClient } from '@supabase/supabase-js';
import { env } from './env';

let adminClient: ReturnType<typeof createClient> | undefined;

// Worker-only module. The Web bundle has no import path to the service-role
// client and therefore does not require or receive this high-privilege key.
export const deleteAuthUser = async (profileId: string): Promise<void> => {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) throw new Error('Supabase service role is required for account erasure');
  adminClient ??= createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { error } = await adminClient.auth.admin.deleteUser(profileId, false);
  if (error) throw new Error(`Failed to delete Supabase Auth user: ${error.message}`);
};
