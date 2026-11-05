import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, ClipboardList, UserCheck } from 'lucide-react';
import { BoardTable } from '../../components/daily/BoardTable';
import { DayPicker } from '../../components/daily/bits';
import { Card, ErrorText, Kpi, PageHeader, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import { fmt } from '../../lib/paths';
import { useLoad } from '../../lib/useLoad';
import { AlertList } from '../shared/AlertList';

/**
 * Target vs done for every operator on one day.
 * Supervisor home (/s) shows their zones; manager's "Daily work" (/m/daily) shows the whole lab.
 */
export default function DailyWork() {
  const { user } = useAuth();
  const [date, setDate] = useState(today());
  const [zone, setZone] = useState('');
  const { data, error } = useLoad(() => (user ? api.dailyBoard(date, user) : Promise.resolve([])), [user, date]);
  if (!user) return null;
  const isManager = user.role === 'MANAGER';
  const all = data ?? [];
  const zones = [...new Set(all.map((r) => r.areaName))];
  const rows = all.filter((r) => !zone || r.areaName === zone);

  const marked = rows.filter((r) => r.attendance).length;
  const present = rows.filter((r) => r.attendance === 'P' || r.attendance === 'HD').length;
  const target = rows.reduce((n, r) => n + r.target, 0);
  const handled = rows.reduce((n, r) => n + r.handled, 0);
  const lost = rows.reduce((n, r) => n + r.lost, 0);
  const pending = rows.reduce((n, r) => n + r.pending, 0);
  const isToday = date === today();
  const s = '/s';

  return (
    <>
      <PageHeader
        title={isManager ? 'Daily work' : 'My zones'}
        subtitle={isManager ? 'Target given and work done by every operator, zone by zone.' : 'Attendance, work given and work done in your zones.'}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <DayPicker value={date} onChange={setDate} max={today()} />
        {zones.length > 1 && (
          <Select value={zone} onChange={(e) => setZone(e.target.value)} className="w-auto" aria-label="Zone">
            <option value="">All zones</option>
            {zones.map((z) => <option key={z}>{z}</option>)}
          </Select>
        )}
      </div>
      <ErrorText>{error}</ErrorText>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Present" value={`${present} / ${rows.length}`} note={marked < rows.length ? `${rows.length - marked} not marked yet` : 'all marked'} />
        <Kpi label="Bottles handled" value={fmt(handled)} note={target ? `of ${fmt(target)} target (${Math.round((100 * handled) / target)}%)` : 'no work given'} />
        <Kpi label="Bottles lost" value={fmt(lost)} note={handled ? `${((100 * lost) / handled).toFixed(1)}% of handled` : undefined} />
        <Kpi label="Entries to check" value={pending} note={pending ? <Link to={`${s}/verify`} className="font-semibold text-forest-700 underline">Check now</Link> : 'nothing waiting'} />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <Link to={`${s}/attendance`} className="focus-ring inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-forest-700 bg-white px-4 text-sm font-semibold text-forest-700 hover:bg-forest-50"><UserCheck size={16} /> Mark attendance</Link>
        <Link to={`${s}/assign`} className="focus-ring inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-forest-700 bg-white px-4 text-sm font-semibold text-forest-700 hover:bg-forest-50"><ClipboardList size={16} /> Give work</Link>
        <Link to={`${s}/verify`} className="focus-ring inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-forest-700 bg-white px-4 text-sm font-semibold text-forest-700 hover:bg-forest-50"><ClipboardCheck size={16} /> Check entries</Link>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Card title={`Operators (${rows.length})`}>
          <BoardTable rows={rows} loading={!data} showZone={zones.length > 1} />
          <p className="mt-3 text-xs text-ink-muted">
            {isToday ? 'Today is still in progress, so no one is marked below target yet.' : 'Red and amber follow the "Operator below target" limits in Set-up → Alert limits.'}
          </p>
        </Card>
        <AlertList title={isManager ? 'Open alerts' : 'Alerts in my zones'} />
      </div>
    </>
  );
}
