import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { X } from 'lucide-react';
import { NAV } from '../../config/nav';
import { useAuth } from '../../lib/auth';
import { cn } from '../ui/cn';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/** Frame for every logged-in page: sidebar (desktop), drawer (phone/tablet), top bar, and page content. */
export function AppShell() {
  const { user } = useAuth();
  const [drawer, setDrawer] = useState(false);
  if (!user) return null;
  const isOperator = user.role === 'OPERATOR';
  const tabs = NAV.OPERATOR[0].items.slice(0, 4);

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden h-full shrink-0 lg:block">
        <Sidebar role={user.role} />
      </aside>

      {/* Phone / tablet drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <div className="relative h-full w-60">
            <Sidebar role={user.role} onNavigate={() => setDrawer(false)} />
            <button onClick={() => setDrawer(false)} className="absolute right-2 top-4 rounded-lg p-1.5 text-white hover:bg-white/10" aria-label="Close menu">
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setDrawer(true)} />
        <main className={cn('flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6', isOperator && 'pb-24 lg:pb-6')}>
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Operator bottom tabs on phone */}
      {isOperator && (
        <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-white lg:hidden">
          {tabs.map((t) => (
            <NavLink
              key={t.path}
              to={t.path}
              end={t.path === '/o'}
              className={({ isActive }) => cn('flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium', isActive ? 'text-forest-700' : 'text-ink-muted')}
            >
              <t.icon size={20} />
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
