import { useState, type FormEvent } from 'react';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { AttBadge, DayPicker, Progress } from '../../components/daily/bits';
import { StageBadge } from '../../components/production/badges';
import { Button, Card, ErrorText, Field, FormActions, IconButton, Input, Modal, PageHeader, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { addDays, today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import type { AssignInput, AssignmentRow, AssignOptions } from '../../lib/dailyApi';
import { fmt } from '../../lib/paths';
import { useLoad } from '../../lib/useLoad';

/** Supervisor gives each operator work for the day: batch, stage, bench (hood) and a target in bottles. */
export default function AssignWork() {
  const { user } = useAuth();
  const [date, setDate] = useState(today());
  const { data, error, reload } = useLoad(
    () => (user ? Promise.all([api.listAssignments(date, user), api.assignOptions(date, user)]) : Promise.reject(new Error('Not logged in'))),
    [user, date],
  );
  const [editing, setEditing] = useState<null | Partial<AssignInput>>(null);
  const [msg, setMsg] = useState('');
  const [actionError, setActionError] = useState('');
  const [lines, opts] = data ?? [[], null];
  const past = date < today();

  const copyPrev = async () => {
    if (!user) return;
    setMsg('');
    setActionError('');
    try {
      const n = await api.copyPreviousDay(date, user);
      setMsg(n ? `Copied ${n} line${n === 1 ? '' : 's'} from the last working day.` : 'Nothing new to copy (already given, operator absent, or no bottles left).');
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not copy.');
    }
  };
  const remove = async (a: AssignmentRow) => {
    if (!user) return;
    setActionError('');
    try {
      await api.deleteAssignment(a.assignId, user);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not remove.');
    }
  };

  return (
    <>
      <PageHeader
        title="Give work"
        subtitle="Each line is one batch at one stage. Operators see their lines on their phone, and every tray they sub-culture counts towards the target."
        actions={!past && opts && (
          <>
            <Button variant="secondary" onClick={copyPrev}><Copy size={16} /> Copy last working day</Button>
            <Button onClick={() => setEditing({ workDate: date })}><Plus size={16} /> Give work</Button>
          </>
        )}
      />
      <div className="mb-4"><DayPicker value={date} onChange={(d) => { setDate(d); setMsg(''); setActionError(''); }} min={addDays(today(), -30)} max={addDays(today(), 7)} /></div>
      {past && <p className="mb-4 rounded-lg bg-black/[0.04] px-3 py-2 text-sm text-ink-muted">This day is over. Work can be seen here but not changed.</p>}
      {msg && <p className="mb-4 rounded-lg bg-forest-50 px-3 py-2 text-sm text-forest-700">{msg}</p>}
      <ErrorText>{error || actionError}</ErrorText>

      {!opts ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : opts.operators.length === 0 ? (
        <Card><p className="text-sm text-ink-muted">No operators in your zones.</p></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {opts.operators.map((o) => {
            const mine = lines.filter((l) => l.operatorId === o.userId);
            const total = mine.reduce((n, l) => n + l.targetBottles, 0);
            return (
              <Card
                key={o.userId}
                title={<span className="flex items-center gap-2">{o.fullName} <AttBadge status={o.attendance} /></span>}
                action={!past && o.attendance !== 'A' && <Button variant="ghost" onClick={() => setEditing({ workDate: date, operatorId: o.userId })}><Plus size={15} /> Add</Button>}
              >
                {mine.length === 0 ? (
                  <p className="text-sm text-ink-muted">{o.attendance === 'A' ? 'Absent on this day.' : 'No work given yet.'}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {mine.map((l) => (
                      <li key={l.assignId} className="rounded-lg border border-[#EEEAE1] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-semibold">{l.batchCode}</span>
                            <StageBadge code={l.stageCode} />
                            <span className="text-ink-muted">at {l.benchId ? l.benchCode : 'any bench'}</span>
                          </div>
                          {!past && (
                            <div className="flex">
                              <IconButton label="Change" onClick={() => setEditing({ ...l })}><Pencil size={15} /></IconButton>
                              {l.entries === 0 && <IconButton label="Remove" tone="danger" onClick={() => remove(l)}><Trash2 size={15} /></IconButton>}
                            </div>
                          )}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                          <span>{fmt(l.handled)} of <b>{fmt(l.targetBottles)}</b> bottles{l.lost ? <span className="text-redx-700"> · {l.lost} lost</span> : ''}</span>
                          <Progress pct={l.pct} level={l.level} compact />
                        </div>
                      </li>
                    ))}
                    {mine.length > 1 && <li className="text-right text-xs text-ink-muted">Total target {fmt(total)} bottles</li>}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {editing && opts && <AssignForm initial={editing} opts={opts} onClose={() => setEditing(null)} onSaved={reload} />}
    </>
  );
}

function AssignForm({ initial, opts, onClose, onSaved }: { initial: Partial<AssignInput>; opts: AssignOptions; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const working = opts.operators.filter((o) => o.attendance !== 'A');
  const [operatorId, setOperatorId] = useState(initial.operatorId ?? working[0]?.userId ?? 0);
  const [batchId, setBatchId] = useState(initial.batchId ?? opts.batches[0]?.batchId ?? 0);
  const batch = opts.batches.find((b) => b.batchId === batchId);
  const [stageId, setStageId] = useState(initial.stageId ?? batch?.stages[0]?.stageId ?? 0);
  const stage = batch?.stages.find((s) => s.stageId === stageId) ?? batch?.stages[0];
  const op = opts.operators.find((o) => o.userId === operatorId);
  const benches = opts.benches.filter((b) => b.areaId === op?.areaId);
  const [benchId, setBenchId] = useState<number | null>(initial.benchId ?? null);
  const [target, setTarget] = useState<number | ''>(initial.targetBottles ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isEdit = initial.assignId !== undefined;
  const freeNow = (stage?.free ?? 0) + (isEdit && initial.batchId === batchId && initial.stageId === stage?.stageId ? initial.targetBottles ?? 0 : 0);

  const pickBatch = (id: number) => {
    setBatchId(id);
    setStageId(opts.batches.find((b) => b.batchId === id)?.stages[0]?.stageId ?? 0);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !stage) return;
    setBusy(true);
    setError('');
    try {
      await api.saveAssignment({
        assignId: initial.assignId, workDate: initial.workDate!, operatorId, batchId, stageId: stage.stageId,
        benchId: benchId && benches.some((b) => b.benchId === benchId) ? benchId : null, targetBottles: target === '' ? 0 : target,
      }, user);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  if (opts.batches.length === 0) {
    return (
      <Modal title="Give work" onClose={onClose}>
        <p className="text-sm text-ink-muted">There are no running batches with trays in your zones, so there is no work to give.</p>
        <FormActions><Button onClick={onClose}>Close</Button></FormActions>
      </Modal>
    );
  }

  return (
    <Modal title={isEdit ? 'Change work' : 'Give work'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Operator">
          <Select value={operatorId} onChange={(e) => setOperatorId(Number(e.target.value))} disabled={isEdit}>
            {opts.operators.map((o) => <option key={o.userId} value={o.userId} disabled={o.attendance === 'A'}>{o.fullName}{o.attendance === 'A' ? ' (absent)' : o.attendance === 'HD' ? ' (half day)' : !o.attendance ? ' (not marked yet)' : ''}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Batch">
            <Select value={batchId} onChange={(e) => pickBatch(Number(e.target.value))}>
              {opts.batches.map((b) => <option key={b.batchId} value={b.batchId}>{b.batchCode}</option>)}
            </Select>
          </Field>
          <Field label="Stage">
            <Select value={stage?.stageId ?? 0} onChange={(e) => setStageId(Number(e.target.value))}>
              {batch?.stages.map((s) => <option key={s.stageId} value={s.stageId}>{s.code} · {fmt(s.bottles)} bottles</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Bench (hood)" hint="Optional. Where the operator sits to work.">
          <Select value={benchId ?? ''} onChange={(e) => setBenchId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Any bench</option>
            {benches.map((b) => <option key={b.benchId} value={b.benchId}>{b.code} · {b.areaName}</option>)}
          </Select>
        </Field>
        <Field label="Target (bottles to sub-culture)" hint={stage ? `${fmt(freeNow)} bottles of ${batch?.batchCode} at ${stage.code} not yet given to anyone on this day (${stage.trays} trays).` : undefined}>
          <Input type="number" min={1} max={freeNow} value={target} onChange={(e) => setTarget(e.target.value === '' ? '' : Math.max(0, Math.round(Number(e.target.value))))} autoFocus />
        </Field>
        {op?.attendance === 'HD' && <p className="rounded-lg bg-amberx-100 px-3 py-2 text-sm text-amberx-700">{op.fullName} is on half day. Consider half the usual target.</p>}
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !working.length}>{busy ? 'Saving…' : 'Save'}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
