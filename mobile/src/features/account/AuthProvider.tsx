import { createContext, type PropsWithChildren, useContext, useMemo } from 'react';

type AuthContextValue = {
  configured: boolean;
  initializing: boolean;
  isGuest: boolean;
  legalApproved: boolean;
  recoveryMode: boolean;
  session: null;
  user: null;
  clearRecovery: () => void;
  deleteAccount: () => Promise<void>;
  sendPasswordReset: (_email: string) => Promise<void>;
  signIn: (_email: string, _password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signUp: (_email: string, _password: string, _fullName: string) => Promise<void>;
  updatePassword: (_password: string) => Promise<void>;
};

const defaultAuthValue: AuthContextValue = {
  configured: false,
  initializing: false,
  isGuest: true,
  legalApproved: true,
  recoveryMode: false,
  session: null,
  user: null,
  clearRecovery() {},
  async deleteAccount() {},
  async sendPasswordReset() {},
  async signIn() {},
  async signOut() {},
  async signUp() {},
  async updatePassword() {},
};

const AuthContext = createContext<AuthContextValue>(defaultAuthValue);

export function AuthProvider({ children }: PropsWithChildren) {
  const value = useMemo<AuthContextValue>(() => defaultAuthValue, []);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
