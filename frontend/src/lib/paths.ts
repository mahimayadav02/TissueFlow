import type { User } from './types';

/** Start of the addresses for the user's role: /m manager, /s supervisor, /o operator. */
export function basePath(user: User | null): '/m' | '/s' | '/o' {
  return user?.role === 'MANAGER' ? '/m' : user?.role === 'SUPERVISOR' ? '/s' : '/o';
}

export const fmt = (n: number) => n.toLocaleString('en-IN');
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
