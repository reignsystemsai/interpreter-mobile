import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';

import { ACCOUNT_SERVICES_CONFIGURED, LEGAL_REVIEW_APPROVED } from '../../config/runtime';
import { authenticatedRequest } from '../../services/api';
import { supabase } from '../../services/supabase';

type AuthContextValue = {
  configured: boolean;
  initializing: boolean;
  legalApproved: boolean;
  session: Session | null;
  user: User | null;
  deleteAccount: () => Promise<void>;
  sendPasswordReset: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setInitializing(false);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setInitializing(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured: ACCOUNT_SERVICES_CONFIGURED,
    initializing,
    legalApproved: LEGAL_REVIEW_APPROVED,
    session,
    user: session?.user ?? null,
    async deleteAccount() {
      await authenticatedRequest<void>('/api/v1/account/me', { method: 'DELETE' });
      await supabase?.auth.signOut();
    },
    async sendPasswordReset() {
      if (!supabase || !session?.user.email) throw new Error('No account email is available.');
      const { error } = await supabase.auth.resetPasswordForEmail(session.user.email);
      if (error) throw error;
    },
    async signIn(email, password) {
      if (!supabase) throw new Error('Account services are not configured yet.');
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    },
    async signOut() {
      const { error } = (await supabase?.auth.signOut()) ?? { error: null };
      if (error) throw error;
    },
    async signUp(email, password, fullName) {
      if (!LEGAL_REVIEW_APPROVED) {
        throw new Error('Account creation opens after the Terms and Privacy Notice complete legal review.');
      }
      if (!supabase) throw new Error('Account services are not configured yet.');
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName.trim() } },
      });
      if (error) throw error;
    },
  }), [initializing, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
