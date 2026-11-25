import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sprout } from 'lucide-react';
import { HOME_OF, useAuth } from '../../lib/auth';

/** Header and footer for the pages anyone can open: about, forgot and reset password. */
export function PublicLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return (
    <div className="min-h-full bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/login" className="focus-ring flex items-center gap-2 rounded-lg">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-forest"><Sprout size={18} className="text-[#9FD3B8]" /></span>
            <span className="font-display text-lg font-semibold tracking-tight text-forest">TissueFlow</span>
          </Link>
          <nav aria-label="Site" className="hidden flex-1 items-center gap-5 text-sm text-ink-muted md:flex">
            <Link to="/about" className="hover:text-ink">About the project</Link>
          </nav>
          <div className="ml-auto md:ml-0">
            {user ? (
              <Link to={HOME_OF[user.role]} className="focus-ring inline-flex min-h-[40px] items-center rounded-lg bg-forest-700 px-4 text-sm font-semibold text-white hover:bg-forest-600">Open dashboard</Link>
            ) : (
              <Link to="/login" className="focus-ring inline-flex min-h-[40px] items-center rounded-lg bg-forest-700 px-4 text-sm font-semibold text-white hover:bg-forest-600">Sign in</Link>
            )}
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p><span className="font-semibold text-ink">TissueFlow</span>, the IoT Enabled Automated Tissue Management System. A final-year B.Tech CSE project at IGDTUW.</p>
          <div className="flex gap-4">
            <Link to="/about" className="hover:text-ink">About</Link>
            <Link to="/login" className="hover:text-ink">Sign in</Link>
            <a href="https://github.com/mahimayadav02/TissueFlow" className="hover:text-ink" target="_blank" rel="noreferrer">Source code</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
