import type { ReactNode } from 'react';

export function Kpi({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#B9DCC7] bg-forest-50 px-4 py-3">
      <div className="text-xs text-[#2F4F3F]">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold text-[#14532D]">{value}</div>
      {note && <div className="mt-0.5 text-xs text-ink-muted">{note}</div>}
    </div>
  );
}
