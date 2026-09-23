import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

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

export type AuthSessionState = {
  session: Session | null;
  loading: boolean;
  recovery: boolean;
};

export const reduceAuthSessionState = (
  current: AuthSessionState,
  event: AuthChangeEvent,
  session: Session | null
): AuthSessionState => ({
  session,
  loading: false,
  recovery: nextRecoveryState(current.recovery, event)
});
