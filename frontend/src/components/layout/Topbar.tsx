import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, ChevronDown, HelpCircle, LogOut, Map, Menu, UserRound } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { basePath } from '../../lib/paths';
import { ROLE_LABEL } from '../../lib/types';
import { Badge } from '../ui/Badge';
import { startTour } from './Tour';

/** Initials for the round avatar, e.g. "R. Patil" → "RP". */
export const initials = (name: string) => name.split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, logout, lab, areas } = useAuth();
  const [openAlerts, setOpenAlerts] = useState(0);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { pathname } = useLocation();

  // Count open alerts again on every page change, so the bell is right after alerts are acknowledged.
  useEffect(() => {
    if (!user) return;
    api.getAlerts(user).then((list) => setOpenAlerts(list.filter((a) => !a.ackAt).length));
  }, [user, pathname]);
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);

  if (!user) return null;
  const base = basePath(user);
  const zoneNames = user.zoneIds.map((id) => areas.find((a) => a.areaId === id)?.name).filter(Boolean).join(', ');
  const item = 'focus-ring flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-forest-50';

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
      <button onClick={onMenu} className="focus-ring -ml-1 rounded-lg p-2 lg:hidden" aria-label="Open menu">
        <Menu size={20} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">{lab?.name ?? ''}</div>
        <div className="truncate text-xs text-ink-muted">{lab?.address ?? ''}</div>
      </div>
      <Badge tone="amber" className="hidden sm:inline-flex">Sample data</Badge>
      <Link to={`${base}/help`} className="focus-ring hidden rounded-lg p-2 text-ink-muted hover:bg-black/5 hover:text-ink sm:block" aria-label="Help">
        <HelpCircle size={20} />
      </Link>
      <Link to={`${base}/alerts`} className="focus-ring relative rounded-lg p-2 text-ink-muted hover:bg-black/5 hover:text-ink" aria-label={`Alerts (${openAlerts} open)`}>
        <Bell size={20} />
        {openAlerts > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-redx-700 px-1 text-[11px] font-bold text-white">{openAlerts}</span>
        )}
      </Link>
      <div ref={menuRef} className="relative">
        <button onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu} className="focus-ring flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 hover:bg-black/5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-forest text-xs font-semibold text-white">{initials(user.fullName)}</span>
          <span className="hidden text-left leading-tight md:block">
            <span className="block text-sm font-semibold text-ink">{user.fullName}</span>
            <span className="block text-xs text-ink-muted">{ROLE_LABEL[user.role]}</span>
          </span>
          <ChevronDown size={16} className="text-ink-muted" />
        </button>
        {menu && (
          <div role="menu" className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-line bg-white p-1.5 shadow-lg">
            <div className="border-b border-line px-3 pb-2.5 pt-1.5">
              <div className="text-sm font-semibold">{user.fullName}</div>
              <div className="text-xs text-ink-muted">{ROLE_LABEL[user.role]}{zoneNames ? ` of ${zoneNames}` : ''}</div>
            </div>
            <div className="pt-1.5">
              <Link role="menuitem" to={`${base}/profile`} className={item}><UserRound size={16} /> My profile</Link>
              <Link role="menuitem" to={`${base}/help`} className={item}><HelpCircle size={16} /> Help and guide</Link>
              <button role="menuitem" onClick={() => { setMenu(false); startTour(); }} className={item}><Map size={16} /> Take the tour</button>
              <button role="menuitem" onClick={logout} className={`${item} text-redx-700`}><LogOut size={16} /> Sign out</button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
