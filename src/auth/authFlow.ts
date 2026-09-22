import type { AuthChangeEvent } from '@supabase/supabase-js';

export type AuthView = 'LOADING' | 'LOGIN' | 'RECOVERY' | 'VERIFY_EMAIL' | 'WORKSPACE';

export const resolveAuthView = (input: {
  loading: boolean;
  recovery: boolean;
  hasUser: boolean;
  emailConfirmed: boolean;
}): AuthView => {
  if (input.loading) return 'LOADING';
  if (input.recovery) return 'RECOVERY';
  if (!input.hasUser) return 'LOGIN';
  return input.emailConfirmed ? 'WORKSPACE' : 'VERIFY_EMAIL';
};

export const nextRecoveryState = (current: boolean, event: AuthChangeEvent): boolean => {
  if (event === 'PASSWORD_RECOVERY') return true;
  if (event === 'SIGNED_OUT') return false;
  return current;
};
