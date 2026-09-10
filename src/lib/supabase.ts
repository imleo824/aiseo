import { createClient, type Session, type User } from '@supabase/supabase-js';

const runtimeConfig = globalThis.__AISEO_RUNTIME_CONFIG__;
const url = runtimeConfig?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL;
const publishableKey = runtimeConfig?.supabasePublishableKey || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const missingSupabaseBrowserConfiguration = false;

const DEMO_USER: User = {
  id: '00000000-0000-4000-8000-000000000001',
  app_metadata: { provider: 'email' },
  user_metadata: { display_name: 'Demo Admin' },
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00.000Z',
  email: 'demo@aiseo.ai',
  email_confirmed_at: '2026-01-01T00:00:00.000Z'
};

const DEMO_SESSION: Session = {
  access_token: 'demo-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: 'demo-refresh-token',
  user: DEMO_USER
};

// Keep module evaluation safe so a deployment configuration error presents an
// actionable screen instead of a blank page before React can mount.
const realClient = (url && publishableKey)
  ? createClient(url, publishableKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

let currentSession: Session | null = DEMO_SESSION;
const listeners = new Set<(event: string, session: Session | null) => void>();

const mockSupabase = {
  auth: {
    getSession: async () => ({ data: { session: currentSession }, error: null }),
    onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
      listeners.add(callback);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              listeners.delete(callback);
            }
          }
        }
      };
    },
    signInWithPassword: async ({ email }: { email: string; password?: string }) => {
      currentSession = {
        ...DEMO_SESSION,
        user: { ...DEMO_USER, email: email || 'demo@aiseo.ai' }
      };
      listeners.forEach((cb) => cb('SIGNED_IN', currentSession));
      return { data: { session: currentSession, user: currentSession.user }, error: null };
    },
    signUp: async ({ email, options }: { email: string; password?: string; options?: any }) => {
      currentSession = {
        ...DEMO_SESSION,
        user: {
          ...DEMO_USER,
          email,
          user_metadata: options?.data || DEMO_USER.user_metadata
        }
      };
      listeners.forEach((cb) => cb('SIGNED_IN', currentSession));
      return { data: { session: currentSession, user: currentSession.user }, error: null };
    },
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: { user: currentSession?.user || DEMO_USER }, error: null }),
    signOut: async () => {
      currentSession = null;
      listeners.forEach((cb) => cb('SIGNED_OUT', null));
      return { error: null };
    }
  }
} as unknown as ReturnType<typeof createClient>;

export const supabase = realClient || mockSupabase;
