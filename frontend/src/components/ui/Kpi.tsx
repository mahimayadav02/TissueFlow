import type { ReactNode } from 'react';
import { InfoTip } from './InfoTip';

/** One headline number: what it is, the number, and a line that puts it in context. */
export function Kpi({ label, value, note, help }: { label: string; value: ReactNode; note?: ReactNode; help?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3.5">
      <div className="flex items-center text-[13px] text-ink-muted">{label}{help && <InfoTip label={`About ${label}`}>{help}</InfoTip>}</div>
      <div className="mt-1.5 font-display text-[26px] font-semibold leading-none tracking-tight tabular-nums text-forest">{value}</div>
      {note && <div className="mt-1.5 text-xs text-ink-muted">{note}</div>}
    </div>
  );
}
