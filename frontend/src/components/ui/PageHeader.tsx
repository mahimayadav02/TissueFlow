import { useState, type ReactNode } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

/**
 * Page title, one-line purpose, actions on the right.
 * `help` adds a "How this page works" panel the reader can open, for steps and terms that need more than a line.
 */
export function PageHeader({ title, subtitle, actions, help }: { title: string; subtitle?: ReactNode; actions?: ReactNode; help?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] font-semibold tracking-tight text-ink sm:text-[30px]">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-[15px] text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {help && (
        <div className="mt-3">
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="focus-ring inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-forest-700 hover:underline">
            <HelpCircle size={16} /> How this page works <ChevronDown size={15} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>
          {open && <div className="mt-2 max-w-3xl rounded-xl border border-[#C9DDD0] bg-forest-50 px-4 py-3 text-sm leading-relaxed text-ink [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">{help}</div>}
        </div>
      )}
    </div>
  );
}
