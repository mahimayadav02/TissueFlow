import { useEffect, useState } from 'react';
import { CheckCheck } from 'lucide-react';
import { AttBadge, DayPicker } from '../../components/daily/bits';
import { Button, Card, ErrorText, PageHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { addDays, today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import { ATT_LABEL, type AttStatus } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';

const CHOICES: AttStatus[] = ['P', 'HD', 'A'];
const TONE: Record<AttStatus, string> = {
  P: 'border-forest-700 bg-forest-700 text-white',
  HD: 'border-amberx-700 bg-amberx-700 text-white',
  A: 'border-redx-700 bg-redx-700 text-white',
};

/** Supervisor marks each operator present, half day or absent. Can be changed for up to 7 days back. */
export default function Attendance() {
  const { user } = useAuth();
  const [date, setDate] = useState(today());
  const { data, error, reload } = useLoad(() => (user ? api.getAttendance(date, user) : Promise.resolve([])), [user, date]);
  const [marks, setMarks] = useState<Record<number, AttStatus>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const m: Record<number, AttStatus> = {};
    for (const r of data ?? []) if (r.status) m[r.userId] = r.status;
    setMarks(m);
    setSaved(false);
    setSaveError('');
  }, [data]);

  const rows = data ?? [];
  const changed = rows.filter((r) => marks[r.userId] && marks[r.userId] !== r.status);
  const set = (id: number, s: AttStatus) => { setMarks({ ...marks, [id]: s }); setSaved(false); };
  const allPresent = () => {
    const m = { ...marks };
    for (const r of rows) if (!m[r.userId]) m[r.userId] = 'P';
    setMarks(m);
    setSaved(false);
  };
  const submit = async () => {
    if (!user) return;
    setBusy(true);
    setSaveError('');
    try {
      await api.markAttendance(date, changed.map((r) => ({ userId: r.userId, status: marks[r.userId] })), user);
      await reload();
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  const count = (s: AttStatus) => rows.filter((r) => marks[r.userId] === s).length;

  return (
    <>
      <PageHeader title="Attendance" subtitle="Mark each operator at the start of the shift. Absent operators cannot be given work for that day." />
      <div className="mb-4"><DayPicker value={date} onChange={setDate} min={addDays(today(), -7)} max={today()} /></div>
      <ErrorText>{error}</ErrorText>

      <Card
        title={`${count('P')} present · ${count('HD')} half day · ${count('A')} absent · ${rows.length - Object.keys(marks).length} not marked`}
        action={<Button variant="ghost" onClick={allPresent} disabled={!rows.length}><CheckCheck size={16} /> Rest present</Button>}
      >
        {!data ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink-muted">No operators in your zones.</p>
        ) : (
          <ul className="divide-y divide-[#EEEAE1]">
            {rows.map((r) => (
              <li key={r.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-[140px]">
                  <div className="font-semibold">{r.fullName}</div>
                  <div className="text-xs text-ink-muted">{r.areaName}{r.markedByName ? ` · saved by ${r.markedByName}` : ''}</div>
                </div>
                <div className="flex items-center gap-3">
                  {r.status && marks[r.userId] !== r.status && <span className="text-xs text-ink-muted">was <AttBadge status={r.status} /></span>}
                  <div className="flex overflow-hidden rounded-lg border border-[#C6BFB0]" role="radiogroup" aria-label={`Attendance of ${r.fullName}`}>
                    {CHOICES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={marks[r.userId] === c}
                        onClick={() => set(r.userId, c)}
                        className={`focus-ring min-h-[44px] min-w-[72px] border-l border-[#C6BFB0] px-3 text-sm font-semibold first:border-l-0 ${marks[r.userId] === c ? TONE[c] : 'bg-white text-ink'}`}
                      >
                        {ATT_LABEL[c]}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <ErrorText>{saveError}</ErrorText>
        <div className="mt-4 flex items-center justify-end gap-3">
          {saved && !changed.length && <span className="text-sm font-semibold text-forest-700">Saved.</span>}
          <Button onClick={submit} disabled={busy || !changed.length}>{busy ? 'Saving…' : `Save attendance${changed.length ? ` (${changed.length})` : ''}`}</Button>
        </div>
      </Card>
    </>
  );
}
