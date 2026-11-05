import { createContext, useContext, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Role, Session, User } from './types';

interface AuthValue {
  user: User | null;
  login: (phone: string, password: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);
const KEY = 'tissueflow.session';

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readSession);

  const login = async (phone: string, password: string) => {
    const s = await api.login(phone, password);
    setSession(s);
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage not available */ }
    return s.user;
  };

  const logout = () => {
    setSession(null);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  };

  return <AuthContext.Provider value={{ user: session?.user ?? null, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Home page of each role. */
export const HOME_OF: Record<Role, string> = {
  MANAGER: '/m',
  SUPERVISOR: '/s',
  OPERATOR: '/o',
};
