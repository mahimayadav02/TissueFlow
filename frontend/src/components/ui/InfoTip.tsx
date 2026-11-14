import { useId, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

/** A small (i) that explains a term. Opens on hover, keyboard focus or tap. */
export function InfoTip({ children, label = 'What does this mean?' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="focus-ring ml-1 rounded-full text-ink-muted hover:text-forest-700"
      >
        <Info size={14} />
      </button>
      {open && (
        <span id={id} role="tooltip" className="absolute bottom-full left-1/2 z-40 mb-2 w-64 -translate-x-1/2 rounded-lg bg-forest px-3 py-2 text-left text-xs font-normal leading-relaxed text-white shadow-lg">
          {children}
        </span>
      )}
    </span>
  );
}
