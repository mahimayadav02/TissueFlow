import { Link } from 'react-router-dom';
import { ClipboardPen, ScanLine } from 'lucide-react';
import { AttBadge, EntryBadge, Progress } from '../../components/daily/bits';
import { KindTag, WorkDone, WorkWhat } from '../../components/daily/WorkBits';
import { Card, Kpi } from '../../components/ui';
import { api } from '../../lib/api';
import { addDays, today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import { fmt } from '../../lib/paths';
import { workZones } from '../../lib/work';
import { useLoad } from '../../lib/useLoad';
import { AlertList } from '../shared/AlertList';

/** Operator home (phone): today's work from the supervisor, progress, and anything sent back. */
export default function OperatorHome() {
  const { user, areas } = useAuth();
  const { data } = useLoad(
    () => (user ? Promise.all([api.listAssignments(today(), user), api.todayAttendance(user), api.listEntries(user, { from: today() }), api.mySentBack(user)]) : Promise.reject(new Error('Not logged in'))),
    [user],
  );
  if (!user) return null;
  const zones = workZones(user).map((id) => areas.find((a) => a.areaId === id)).filter((a) => !!a);
  const dateLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const [lines, att, entries, sentBack] = data ?? [[], null, [], []];
  const live = entries.filter((e) => e.status !== 'REJECTED');
  const target = lines.reduce((n, l) => n + l.target, 0);
  const handled = live.reduce((n, e) => n + e.bottlesHandled, 0);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div>
        <p className="text-sm text-ink-muted">{dateLabel}</p>
        <h1 className="font-display text-2xl font-semibold">Hello, {user.fullName}</h1>
        <p className="flex items-center gap-2 text-sm text-ink-muted">{zones.length ? zones.map((a) => a!.name).join(' + ') : 'No zone assigned'} {data && <AttBadge status={att} />}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Link to="/o/scan" className="focus-ring flex flex-col items-center justify-center gap-1.5 rounded-xl bg-forest-700 py-5 text-base font-semibold text-white">
          <ScanLine size={26} /> Scan tray
        </Link>
        <Link to="/o/enter" className="focus-ring flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-forest-700 bg-white py-5 text-base font-semibold text-forest-700">
          <ClipboardPen size={26} /> Record work
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Kpi label="Today's target" value={target ? fmt(target) : '—'} note="bottles" />
        <Kpi label="Done so far" value={fmt(handled)} note={`${live.length} entr${live.length === 1 ? 'y' : 'ies'} · ${live.filter((e) => e.status === 'PENDING').length} to be checked`} />
      </div>

      {sentBack.length > 0 && (
        <Card title="Sent back by supervisor" className="border-redx-700/40">
          <ul className="flex flex-col gap-2 text-sm">
            {sentBack.map((e) => (
              <li key={e.entryId} className="rounded-lg bg-redx-100 px-3 py-2 text-redx-700">
                <b>{e.source === 'QR' ? <span className="font-mono">{e.qrCode}</span> : `${e.label}, ${e.bottlesHandled} bottles`}</b>{e.workDate !== today() && ` (${e.workDate === addDays(today(), -1) ? 'yesterday' : e.workDate})`}: “{e.note}”
                <div className="text-xs">{e.source === 'QR' ? 'Scan the tray again and enter it correctly.' : 'Enter it again with the right counts.'}</div>
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
              <li key={l.assignId} className="rounded-lg border border-[#E6ECE8] p-3">
                <WorkWhat line={l} showBench={!!l.benchId} />
                <div className="mt-2 text-sm"><WorkDone line={l} /></div>
                <div className="mt-1"><Progress pct={l.pct} level={l.level} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {live.length > 0 && (
        <Card title="Done today">
          <ul className="divide-y divide-[#E6ECE8] text-sm">
            {live.map((e) => (
              <li key={e.entryId} className="flex items-center justify-between gap-2 py-2">
                <span className="flex flex-wrap items-center gap-1.5">
                  {e.kind === 'SUBCULTURE' ? <span className={e.source === 'QR' ? 'font-mono font-semibold' : 'font-semibold'}>{e.source === 'QR' ? e.qrCode : e.label}</span> : <KindTag kind={e.kind} />}
                  <span className="text-ink-muted">{e.bottlesHandled}{e.kind === 'SUBCULTURE' ? ` → ${e.bottlesProduced}` : ''}{e.bottlesLost ? `, ${e.bottlesLost} ${e.kind === 'SUBCULTURE' ? 'lost' : 'failed'}` : ''}{e.source === 'MANUAL' ? ' · typed in' : ''}</span>
                </span>
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
