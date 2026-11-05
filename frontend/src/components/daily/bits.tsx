import { Badge } from '../ui';
import type { Level } from '../../lib/dailyApi';
import { ATT_LABEL, type AttStatus, type EntryStatus } from '../../lib/types';

/** Present / half day / absent / not marked. */
export function AttBadge({ status }: { status: AttStatus | null }) {
  if (!status) return <Badge>Not marked</Badge>;
  return <Badge tone={status === 'P' ? 'green' : status === 'HD' ? 'amber' : 'red'}>{ATT_LABEL[status]}</Badge>;
}

export function EntryBadge({ status }: { status: EntryStatus }) {
  if (status === 'PENDING') return <Badge tone="amber">To check</Badge>;
  if (status === 'VERIFIED') return <Badge tone="green">Verified</Badge>;
  return <Badge tone="red">Sent back</Badge>;
}

/** Bar showing done against target. Colour follows the LOW_OUTPUT alert limits once the day is over. */
export function Progress({ pct, level, compact = false }: { pct: number | null; level: Level; compact?: boolean }) {
  if (pct === null) return <span className="text-ink-muted">—</span>;
  const colour = level === 'CRITICAL' ? 'bg-redx-700' : level === 'WARNING' ? 'bg-amberx-700' : 'bg-forest-500';
  return (
    <div className={`flex items-center gap-2 ${compact ? 'min-w-[110px]' : 'min-w-[150px]'}`}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/[0.07]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${colour}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className={`w-11 text-right text-xs font-semibold tabular-nums ${level === 'CRITICAL' ? 'text-redx-700' : level === 'WARNING' ? 'text-amberx-700' : ''}`}>{pct}%</span>
    </div>
  );
}

/** Date picker row with quick buttons for yesterday / today / tomorrow. */
export function DayPicker({ value, onChange, min, max }: { value: string; onChange: (d: string) => void; min?: string; max?: string }) {
  const shift = (n: number) => {
    const d = new Date(value + 'T12:00:00');
    d.setDate(d.getDate() + n);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if ((!min || iso >= min) && (!max || iso <= max)) onChange(iso);
  };
  const label = new Date(value + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => shift(-1)} className="focus-ring rounded-lg border border-[#C6BFB0] bg-white px-3 py-2 text-sm" aria-label="Previous day">‹</button>
      <input type="date" value={value} min={min} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} className="focus-ring rounded-lg border border-[#C6BFB0] bg-white px-3 py-2 text-sm" aria-label="Date" />
      <button type="button" onClick={() => shift(1)} className="focus-ring rounded-lg border border-[#C6BFB0] bg-white px-3 py-2 text-sm" aria-label="Next day">›</button>
      <span className="text-sm text-ink-muted">{label}</span>
    </div>
  );
}
