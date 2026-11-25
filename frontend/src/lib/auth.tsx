import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { USE_SERVER, refresh, serverAuth, setSignedOutHandler } from './server';
import { db } from './store';
import type { Area, Lab, Role, Session, User } from './types';

interface AuthValue {
  user: User | null;
  /** False while the app is still finding out whether someone is signed in (server only). */
  ready: boolean;
  login: (phone: string, password: string) => Promise<User>;
  logout: () => void;
  /** Lab name and zones, for headers and labels. */
  lab: Lab | null;
  areas: Area[];
  reloadLabInfo: () => void;
  /** Server only: signs out on every device. */
  logoutAll: () => Promise<void>;
  /** Server only: changes the password; other devices are signed out. */
  changePassword: (current: string, next: string) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
const KEY = 'tissueflow.session';

function readSession(): Session | null {
  if (USE_SERVER) return null; // with the server, the sign-in lives in a cookie the page cannot read
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readSession);
  const [ready, setReady] = useState(!USE_SERVER);
  const [lab, setLab] = useState<Lab | null>(USE_SERVER ? null : db.lab);
  const [areas, setAreas] = useState<Area[]>(USE_SERVER ? [] : db.areas);

  const reloadLabInfo = useCallback(() => {
    if (!USE_SERVER) {
      setLab({ ...db.lab });
      setAreas([...db.areas]);
      return;
    }
    Promise.all([api.getLab(), api.listAreas()]).then(([l, a]) => { setLab(l); setAreas(a); }).catch(() => undefined);
  }, []);

  // Server: find out whether this browser is still signed in (refresh cookie), once on page load.
  useEffect(() => {
    if (!USE_SERVER) return;
    setSignedOutHandler(() => setSession(null));
    refresh().then((s) => {
      setSession(s);
      if (s) reloadLabInfo();
      setReady(true);
    });
  }, [reloadLabInfo]);

  const login = async (phone: string, password: string) => {
    const s = await api.login(phone, password);
    setSession(s);
    if (USE_SERVER) reloadLabInfo();
    else try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage not available */ }
    return s.user;
  };

  const logout = () => {
    setSession(null);
    if (USE_SERVER) void serverAuth.logout();
    else try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  };

  const logoutAll = async () => {
    await serverAuth.logoutAll();
    setSession(null);
  };

  const changePassword = async (current: string, next: string) => {
    const s = await serverAuth.changePassword(current, next);
    setSession(s);
  };

  return (
    <AuthContext.Provider value={{ user: session?.user ?? null, ready, login, logout, lab, areas, reloadLabInfo, logoutAll, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Name of a zone by id, from the loaded zone list. */
export function useAreaName() {
  const { areas } = useAuth();
  return (id: number | null | undefined) => areas.find((a) => a.areaId === id)?.name;
}

/** Home page of each role. */
export const HOME_OF: Record<Role, string> = {
  MANAGER: '/m',
  SUPERVISOR: '/s',
  OPERATOR: '/o',
};
