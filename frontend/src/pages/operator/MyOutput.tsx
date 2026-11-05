import { useState } from 'react';
import { AttBadge, Progress } from '../../components/daily/bits';
import { Card, Kpi } from '../../components/ui';
import { api } from '../../lib/api';
import { today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import { fmt } from '../../lib/paths';
import { useLoad } from '../../lib/useLoad';

/** Operator's own work over the last 7 or 30 days: target, bottles handled, new bottles, losses. */
export default function MyOutput() {
  const { user } = useAuth();
  const [days, setDays] = useState(7);
  const { data } = useLoad(() => (user ? api.myOutput(user, days) : Promise.resolve([])), [user, days]);
  const rows = data ?? [];
  const worked = rows.filter((r) => r.handled > 0);
  const handled = rows.reduce((n, r) => n + r.handled, 0);
  const target = rows.filter((r) => r.workDate < today()).reduce((n, r) => n + r.target, 0);
  const handledPast = rows.filter((r) => r.workDate < today()).reduce((n, r) => n + r.handled, 0);
  const lost = rows.reduce((n, r) => n + r.lost, 0);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold">My output</h1>
      <div className="flex gap-2">
        {[7, 30].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={`focus-ring rounded-full border px-3 py-1.5 text-sm ${days === d ? 'border-forest-700 bg-forest-700 text-white' : 'border-[#C6BFB0] bg-white'}`}>Last {d} days</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Kpi label="Days worked" value={worked.length} />
        <Kpi label="Bottles handled" value={fmt(handled)} />
        <Kpi label="Target achieved" value={target ? `${Math.round((100 * handledPast) / target)}%` : '—'} note="finished days only" />
        <Kpi label="Loss" value={handled ? `${((100 * lost) / handled).toFixed(1)}%` : '—'} note={`${lost} bottles`} />
      </div>
      <Card title="Day by day">
        {!data ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink-muted">No work in this period.</p>
        ) : (
          <ul className="divide-y divide-[#EEEAE1]">
            {rows.map((r) => (
              <li key={r.workDate} className="py-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-semibold">{r.workDate === today() ? 'Today' : new Date(r.workDate + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  <AttBadge status={r.attendance} />
                </div>
                {r.target > 0 || r.handled > 0 ? (
                  <>
                    <div className="mt-1 text-sm text-ink-muted">
                      {fmt(r.handled)} of {fmt(r.target)} bottles · {fmt(r.produced)} new{r.lost ? ` · ${r.lost} lost` : ''}{r.pending ? ` · ${r.pending} to be checked` : ''}
                    </div>
                    <div className="mt-1"><Progress pct={r.pct} level={r.level} /></div>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
