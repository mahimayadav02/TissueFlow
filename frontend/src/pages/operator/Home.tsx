import { Link } from 'react-router-dom';
import { ScanLine } from 'lucide-react';
import { AttBadge, EntryBadge, Progress } from '../../components/daily/bits';
import { StageBadge } from '../../components/production/badges';
import { Card, Kpi } from '../../components/ui';
import { api } from '../../lib/api';
import { addDays, today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import { fmt } from '../../lib/paths';
import { db } from '../../lib/store';
import { useLoad } from '../../lib/useLoad';
import { AlertList } from '../shared/AlertList';

/** Operator home (phone): today's work from the supervisor, progress, and anything sent back. */
export default function OperatorHome() {
  const { user } = useAuth();
  const { data } = useLoad(
    () => (user ? Promise.all([api.listAssignments(today(), user), api.todayAttendance(user), api.listEntries(user, { from: today() }), api.mySentBack(user)]) : Promise.reject(new Error('Not logged in'))),
    [user],
  );
  if (!user) return null;
  const area = db.areas.find((a) => a.areaId === user.homeAreaId);
  const dateLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const [lines, att, entries, sentBack] = data ?? [[], null, [], []];
  const live = entries.filter((e) => e.status !== 'REJECTED');
  const target = lines.reduce((n, l) => n + l.targetBottles, 0);
  const handled = live.reduce((n, e) => n + e.bottlesHandled, 0);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div>
        <p className="text-sm text-ink-muted">{dateLabel}</p>
        <h1 className="font-display text-2xl font-semibold">Hello, {user.fullName}</h1>
        <p className="flex items-center gap-2 text-sm text-ink-muted">{area ? `${area.name} · room ${area.roomNo}` : 'No zone assigned'} {data && <AttBadge status={att} />}</p>
      </div>
      <Link to="/o/scan" className="focus-ring flex items-center justify-center gap-3 rounded-xl bg-forest-700 py-5 text-lg font-semibold text-white">
        <ScanLine size={26} /> Scan tray
      </Link>
      <div className="grid grid-cols-2 gap-3">
        <Kpi label="Today's target" value={target ? fmt(target) : '—'} note="bottles" />
        <Kpi label="Done so far" value={fmt(handled)} note={`${live.length} tray${live.length === 1 ? '' : 's'} · ${live.filter((e) => e.status === 'PENDING').length} to be checked`} />
      </div>

      {sentBack.length > 0 && (
        <Card title="Sent back by supervisor" className="border-redx-700/40">
          <ul className="flex flex-col gap-2 text-sm">
            {sentBack.map((e) => (
              <li key={e.entryId} className="rounded-lg bg-redx-100 px-3 py-2 text-redx-700">
                <b className="font-mono">{e.qrCode}</b>{e.workDate !== today() && ` (${e.workDate === addDays(today(), -1) ? 'yesterday' : e.workDate})`}: “{e.note}”
                <div className="text-xs">Scan the tray again and enter it correctly.</div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Today's work">
        {!data ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : lines.length === 0 ? (
          <p className="text-sm text-ink-muted">{att === 'A' ? 'You are marked absent today.' : 'No work given yet. Ask your supervisor.'}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {lines.map((l) => (
              <li key={l.assignId} className="rounded-lg border border-[#EEEAE1] p-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold">{l.batchCode}</span>
                  <StageBadge code={l.stageCode} />
                  <span className="text-ink-muted">{l.benchId ? `at ${l.benchCode}` : ''}</span>
                </div>
                <div className="mt-2 text-sm">{fmt(l.handled)} of <b>{fmt(l.targetBottles)}</b> bottles</div>
                <div className="mt-1"><Progress pct={l.pct} level={l.level} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {live.length > 0 && (
        <Card title="Trays done today">
          <ul className="divide-y divide-[#EEEAE1] text-sm">
            {live.map((e) => (
              <li key={e.entryId} className="flex items-center justify-between gap-2 py-2">
                <span><span className="font-mono font-semibold">{e.qrCode}</span> <span className="text-ink-muted">{e.bottlesHandled} → {e.bottlesProduced}{e.bottlesLost ? `, ${e.bottlesLost} lost` : ''}</span></span>
                <EntryBadge status={e.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <AlertList title="Alerts in my area" />
    </div>
  );
}
