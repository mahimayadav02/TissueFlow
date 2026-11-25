import { Link, NavLink } from 'react-router-dom';
import { HelpCircle, MapPin, Sprout } from 'lucide-react';
import { NAV, type NavItem } from '../../config/nav';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ROLE_LABEL, type Role } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';
import { cn } from '../ui/cn';

export function Sidebar({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const { user } = useAuth();
  // Zones for the "Zones" section: every zone for the manager, own zones for a supervisor.
  const { data: areas } = useLoad(() => api.listAreas(), [user]);
  const myAreas = (areas ?? []).filter((a) => role === 'MANAGER' || (user?.zoneIds ?? []).includes(a.areaId));

  const link = (item: NavItem, end: boolean, indent = false) => (
    <NavLink
      key={item.path}
      to={item.path}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn('focus-ring flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm', indent && 'pl-6', isActive ? 'bg-[#2A6453] font-semibold text-white' : 'text-[#D3E3DB] hover:bg-white/5')
      }
    >
      <item.icon size={indent ? 15 : 17} />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );

  return (
    <nav aria-label="Main" className="flex h-full w-60 flex-col gap-1 overflow-y-auto bg-forest px-3 py-5 text-[#E6EEE9]">
      <div className="mb-1 flex items-center gap-2 px-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#2A6453]"><Sprout size={18} className="text-[#9FD3B8]" /></span>
        <span className="font-display text-lg font-semibold tracking-tight text-white">TissueFlow</span>
      </div>
      <div className="mb-3 px-2 text-xs text-sage">{ROLE_LABEL[role]}</div>
      {NAV[role].map((section) => (
        <div key={section.title} className="mb-2">
          <div className="px-3 pb-1 pt-2 text-xs font-semibold text-[#8FB3A4]">{section.title}</div>
          {section.items.map((item) => link(item, item.path.split('/').length <= 2 || item.path === section.zonesBase))}
          {section.zonesBase && myAreas.map((a) => link({ label: a.name, path: `${section.zonesBase}/${a.areaId}`, icon: MapPin, phase: 8 }, false, true))}
        </div>
      ))}
      <div className="mt-auto border-t border-white/10 pt-3">
        <Link to={`${role === 'MANAGER' ? '/m' : role === 'SUPERVISOR' ? '/s' : '/o'}/help`} onClick={onNavigate} className="focus-ring flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[#D3E3DB] hover:bg-white/5"><HelpCircle size={17} /> Help and guide</Link>
      </div>
    </nav>
  );
}
