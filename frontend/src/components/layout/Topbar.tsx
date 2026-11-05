import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, LogOut, Menu } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { db } from '../../lib/store';
import { ROLE_LABEL } from '../../lib/types';
import { Badge } from '../ui/Badge';

const ALERTS_PATH = { MANAGER: '/m/alerts', SUPERVISOR: '/s/alerts', OPERATOR: '/o/alerts' } as const;

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const [openAlerts, setOpenAlerts] = useState(0);
  const { pathname } = useLocation();

  // Count open alerts again on every page change, so the bell is right after alerts are acknowledged.
  useEffect(() => {
    if (!user) return;
    api.getAlerts(user).then((list) => setOpenAlerts(list.filter((a) => !a.ackAt).length));
  }, [user, pathname]);

  if (!user) return null;
  const zoneNames = user.zoneIds.map((id) => db.areas.find((a) => a.areaId === id)?.name).filter(Boolean).join(', ');

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-paper/95 px-4 backdrop-blur sm:px-6">
      <button onClick={onMenu} className="focus-ring -ml-1 rounded-lg p-2 lg:hidden" aria-label="Open menu">
        <Menu size={20} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{user.fullName}</div>
        <div className="truncate text-xs text-ink-muted">
          {ROLE_LABEL[user.role]}
          {zoneNames && ` · ${zoneNames}`}
        </div>
      </div>
      <Badge tone="amber" className="hidden sm:inline-flex">Sample data</Badge>
      <Link to={ALERTS_PATH[user.role]} className="focus-ring relative rounded-lg p-2 hover:bg-black/5" aria-label={`Alerts (${openAlerts} open)`}>
        <Bell size={20} />
        {openAlerts > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-redx-700 px-1 text-[11px] font-bold text-white">{openAlerts}</span>
        )}
      </Link>
      <button onClick={logout} className="focus-ring flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm hover:bg-black/5" aria-label="Log out">
        <LogOut size={18} />
        <span className="hidden sm:inline">Log out</span>
      </button>
    </header>
  );
}
