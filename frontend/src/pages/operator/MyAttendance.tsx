import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, Kpi } from '../../components/ui';
import { api } from '../../lib/api';
import { today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import { ATT_LABEL, type AttStatus } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';

const CELL: Record<AttStatus, string> = {
  P: 'bg-forest-100 text-[#14532D]',
  HD: 'bg-amberx-100 text-amberx-700',
  A: 'bg-redx-100 text-redx-700',
};
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Operator's own attendance, one month at a time, as marked by the supervisor. */
export default function MyAttendance() {
  const { user } = useAuth();
  const [month, setMonth] = useState(today().slice(0, 7));
  const { data } = useLoad(() => (user ? api.myAttendance(user, month) : Promise.resolve([])), [user, month]);
  const rows = data ?? [];
  const byDay = new Map(rows.map((r) => [Number(r.workDate.slice(8, 10)), r.status]));

  const [y, m] = month.split('-').map(Number);
  const daysIn = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (next <= today().slice(0, 7)) setMonth(next);
  };
  const count = (s: AttStatus) => rows.filter((r) => r.status === s).length;
  const title = new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const todayDay = month === today().slice(0, 7) ? Number(today().slice(8, 10)) : 0;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold">My attendance</h1>
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Present" value={count('P')} />
        <Kpi label="Half day" value={count('HD')} />
        <Kpi label="Absent" value={count('A')} />
      </div>
      <Card
        title={title}
        action={
          <div className="flex">
            <button onClick={() => shift(-1)} className="focus-ring rounded-lg p-2 hover:bg-black/5" aria-label="Previous month"><ChevronLeft size={18} /></button>
            <button onClick={() => shift(1)} className="focus-ring rounded-lg p-2 hover:bg-black/5 disabled:opacity-30" disabled={month >= today().slice(0, 7)} aria-label="Next month"><ChevronRight size={18} /></button>
          </div>
        }
      >
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {WEEK.map((w) => <div key={w} className="py-1 font-semibold text-ink-muted">{w}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={'x' + i} />)}
          {Array.from({ length: daysIn }, (_, i) => {
            const d = i + 1;
            const s = byDay.get(d);
            return (
              <div
                key={d}
                title={s ? ATT_LABEL[s] : 'Not marked'}
                className={`flex aspect-square flex-col items-center justify-center rounded-lg text-sm ${s ? CELL[s] : 'text-ink-muted'} ${d === todayDay ? 'ring-2 ring-forest-700' : ''}`}
              >
                <span className="font-semibold">{d}</span>
                {s && <span className="text-[10px] font-semibold">{s}</span>}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-muted">P present · HD half day · A absent. Your supervisor marks this at the start of each shift; talk to them if something is wrong.</p>
      </Card>
    </div>
  );
}
