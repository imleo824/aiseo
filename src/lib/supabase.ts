import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const runtimeConfig = globalThis.__AISEO_RUNTIME_CONFIG__;
const url = runtimeConfig?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL;
const publishableKey = runtimeConfig?.supabasePublishableKey || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const missingSupabaseBrowserConfiguration = !url || !publishableKey;

// Keep module evaluation safe so a deployment configuration error presents an
// actionable screen instead of a blank page before React can mount.
const configuredClient = (url && publishableKey)
  ? createClient(url, publishableKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export const getSupabaseBrowserClient = (): SupabaseClient => {
  if (!configuredClient) {
    throw new Error('Supabase 浏览器认证尚未配置');
  }
  return configuredClient;
};
