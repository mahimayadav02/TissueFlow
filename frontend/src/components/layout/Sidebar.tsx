import { NavLink } from 'react-router-dom';
import { Sprout } from 'lucide-react';
import { NAV } from '../../config/nav';
import { ROLE_LABEL, type Role } from '../../lib/types';
import { cn } from '../ui/cn';

export function Sidebar({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex h-full w-60 flex-col gap-1 overflow-y-auto bg-forest px-3 py-5 text-[#E6EEE9]">
      <div className="mb-1 flex items-center gap-2 px-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#2A6453]"><Sprout size={18} className="text-[#9FD3B8]" /></span>
        <span className="font-display text-lg font-semibold text-white">TissueFlow</span>
      </div>
      <div className="mb-3 px-2 text-xs text-sage">{ROLE_LABEL[role]}</div>
      {NAV[role].map((section) => (
        <div key={section.title} className="mb-2">
          <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[#8FB3A4]">{section.title}</div>
          {section.items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path.split('/').length <= 2}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn('focus-ring flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm', isActive ? 'bg-[#2A6453] font-semibold text-white' : 'text-[#D3E3DB] hover:bg-white/5')
              }
            >
              <item.icon size={17} />
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
