import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { ACCOUNT_SERVICES_CONFIGURED, LEGAL_REVIEW_APPROVED } from '../../config/runtime';
import { authenticatedRequest } from '../../services/api';
import { supabase } from '../../services/supabase';

type AuthContextValue = {
  configured: boolean;
  initializing: boolean;
  isGuest: boolean;
  legalApproved: boolean;
  recoveryMode: boolean;
  session: Session | null;
  user: User | null;
  clearRecovery: () => void;
  deleteAccount: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const isGuest = Boolean(session?.user?.is_anonymous);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setInitializing(false);
      return;
    }
    void client.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        setSession(data.session);
        return;
      }
      const { data: guestData, error } = await client.auth.signInAnonymously({
        options: { data: { access: 'interpreter_guest' } },
      });
      if (error) throw error;
      setSession(guestData.session);
    }).catch(() => setSession(null)).finally(() => setInitializing(false));
    const { data } = client.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const applyAuthUrl = async (url: string | null) => {
      if (!url) return;
      const params = new URLSearchParams(url.includes('#') ? url.split('#')[1] : url.split('?')[1] ?? '');
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const code = params.get('code');
      if (accessToken && refreshToken) {
        const { error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) throw error;
      } else if (code) {
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error) throw error;
      }
      if (params.get('type') === 'recovery') setRecoveryMode(true);
    };
    void Linking.getInitialURL().then(applyAuthUrl).catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void applyAuthUrl(url).catch(() => undefined);
    });
    return () => subscription.remove();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured: ACCOUNT_SERVICES_CONFIGURED,
    initializing,
    legalApproved: LEGAL_REVIEW_APPROVED,
    isGuest,
    recoveryMode,
    session,
    user: session?.user ?? null,
    clearRecovery() {
      setRecoveryMode(false);
    },
    async deleteAccount() {
      await authenticatedRequest<void>('/api/v1/account/me', { method: 'DELETE' });
      await supabase?.auth.signOut();
      await supabase?.auth.signInAnonymously({ options: { data: { access: 'interpreter_guest' } } });
    },
    async sendPasswordReset(email) {
      if (!supabase) throw new Error('Unable to continue. Please try again.');
      const normalizedEmail = email.trim();
      if (!normalizedEmail) throw new Error('Enter your account email.');
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: Linking.createURL('auth/callback'),
      });
      if (error) throw error;
    },
    async signIn(email, password) {
      if (!supabase) throw new Error('Unable to continue. Please try again.');
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    },
    async signOut() {
      const client = supabase;
      const { error } = (await client?.auth.signOut()) ?? { error: null };
      if (error) throw error;
      await client?.auth.signInAnonymously({ options: { data: { access: 'interpreter_guest' } } });
    },
    async signUp(email, password, fullName) {
      if (!LEGAL_REVIEW_APPROVED) {
        throw new Error('Account creation opens after the Terms and Privacy Notice complete legal review.');
      }
      if (!supabase) throw new Error('Unable to continue. Please try again.');
      const { error } = isGuest
        ? await supabase.auth.updateUser({ email: email.trim(), password, data: { full_name: fullName.trim() } }, { emailRedirectTo: Linking.createURL('auth/callback') })
        : await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() }, emailRedirectTo: Linking.createURL('auth/callback') },
        });
      if (error) throw error;
    },
    async updatePassword(password) {
      if (!supabase) throw new Error('Unable to continue. Please try again.');
      if (password.length < 8) throw new Error('Use at least 8 characters.');
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setRecoveryMode(false);
    },
  }), [initializing, isGuest, recoveryMode, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
