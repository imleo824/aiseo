import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const missingSupabaseBrowserConfiguration = !url || !publishableKey;

// Keep module evaluation safe so a deployment configuration error presents an
// actionable screen instead of a blank page before React can mount.
export const supabase = createClient(url || 'https://configuration-required.invalid', publishableKey || 'configuration-required', {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
