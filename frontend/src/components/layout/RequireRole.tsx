import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { HOME_OF, useAuth } from '../../lib/auth';
import type { Role } from '../../lib/types';

/**
 * Page guard. Not logged in → login page. Logged in with a role that may not
 * open this area → sent to their own home page.
 */
export function RequireRole({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  // Still checking with the server whether this browser is signed in.
  if (!ready) return <div className="grid min-h-screen place-items-center text-sm text-ink-muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!allow.includes(user.role)) return <Navigate to={HOME_OF[user.role]} replace />;
  return <>{children}</>;
}
