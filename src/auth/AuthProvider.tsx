import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '../lib/supabase';
import { reduceAuthSessionState, type AuthSessionState } from './authFlow';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  recovery: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const supabase = getSupabaseBrowserClient();
  const [authState, setAuthState] = useState<AuthSessionState>({
    session: null,
    loading: true,
    recovery: false
  });

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setAuthState((current) => reduceAuthSessionState(current, event, nextSession));
    });
    return () => subscription.subscription.unsubscribe();
  }, [supabase]);

  const { session, loading, recovery } = authState;

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user || null,
    loading,
    recovery
  }), [loading, recovery, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
};
