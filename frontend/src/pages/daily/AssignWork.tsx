import { useState, type FormEvent } from 'react';
import { ClipboardPen, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { AttBadge, DayPicker, Progress } from '../../components/daily/bits';
import { MediaStatus, WashStatus, WorkDone, WorkWhat } from '../../components/daily/WorkBits';
import { WorkEntryForm } from '../../components/daily/WorkEntryForm';
import { BatchStageFields, sameCode } from '../../components/daily/BatchStageFields';
import { Button, Card, ErrorText, Field, FormActions, IconButton, Input, Modal, PageHeader, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { addDays, today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import type { AssignInput, AssignmentRow, AssignOptions } from '../../lib/dailyApi';
import { fmt } from '../../lib/paths';
import { WORK_LABEL, type WorkKind } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';
import { HELP } from '../../config/pageHelp';

/** Supervisor gives each operator work for the day, in the way each zone works, and can enter the work done. */
export default function AssignWork() {
  const { user } = useAuth();
  const [date, setDate] = useState(today());
  const { data, error, reload } = useLoad(
    () => (user ? Promise.all([api.listAssignments(date, user), api.assignOptions(date, user)]) : Promise.reject(new Error('Not logged in'))),
    [user, date],
  );
  const [editing, setEditing] = useState<null | Partial<AssignInput>>(null);
  const [entering, setEntering] = useState<null | { operatorId: number; name: string; assignId?: number }>(null);
  const [msg, setMsg] = useState('');
  const [actionError, setActionError] = useState('');
  const [lines, opts] = data ?? [[], null];
  const past = date < today();
  const canEnter = date <= today() && date >= addDays(today(), -7);
  const kinds = new Set(opts?.operators.flatMap((o) => o.zones.flatMap((z) => z.kinds)) ?? []);

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
      <PageHeader help={HELP.assign}
        title="Give work"
        subtitle="Each line is one piece of work with a target in bottles. Operators see their lines on their phone; work they scan or type in counts towards the target."
        actions={!past && opts && (
          <>
            <Button variant="secondary" onClick={copyPrev}><Copy size={16} /> Copy last working day</Button>
            <Button onClick={() => setEditing({ workDate: date })}><Plus size={16} /> Give work</Button>
          </>
        )}
      />
      <div className="mb-4"><DayPicker value={date} onChange={(d) => { setDate(d); setMsg(''); setActionError(''); }} min={addDays(today(), -30)} max={addDays(today(), 7)} /></div>
      {past && <p className="mb-4 rounded-lg bg-black/[0.04] px-3 py-2 text-sm text-ink-muted">This day is over. Work given can be seen here but not changed{canEnter ? '; work done can still be entered for up to 7 days' : ''}. Bottles not done were never taken out, so they are still where they were.</p>}
      {msg && <p className="mb-4 rounded-lg bg-forest-50 px-3 py-2 text-sm text-forest-700">{msg}</p>}
      <ErrorText>{error || actionError}</ErrorText>

      {opts && (kinds.has('WASH') || kinds.has('MEDIA')) && (
        <div className="mb-5 grid gap-4 lg:grid-cols-2">
          {kinds.has('WASH') && (
            <Card title="Wash area now">
              <WashStatus plain={opts.wash.plain} contaminated={opts.wash.contaminated} givenPlain={opts.wash.givenPlain} givenContaminated={opts.wash.givenContaminated} addedPlain={opts.wash.addedPlain} addedContaminated={opts.wash.addedContaminated} />
              <p className="mt-2 text-xs text-ink-muted">Every bottle that has been sub-cultured, whatever its crop, stage or batch, is added here automatically as soon as the work is saved. Contaminated bottles are counted separately.</p>
            </Card>
          )}
          {kinds.has('MEDIA') && <Card><MediaStatus media={opts.media} /></Card>}
        </div>
      )}

      {!opts ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : opts.operators.length === 0 ? (
        <Card><p className="text-sm text-ink-muted">No operators in your zones.</p></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {opts.operators.map((o) => {
            const mine = lines.filter((l) => l.operatorId === o.userId);
            const total = mine.reduce((n, l) => n + l.target, 0);
            return (
              <Card
                key={o.userId}
                title={(
                  <span className="flex flex-wrap items-center gap-2">
                    {o.fullName} <AttBadge status={o.attendance} />
                    <span className="text-xs font-normal text-ink-muted">{o.zones.map((z) => z.name).join(' + ')}</span>
                  </span>
                )}
                action={(
                  <div className="flex gap-1">
                    {canEnter && o.attendance !== 'A' && <Button variant="ghost" onClick={() => setEntering({ operatorId: o.userId, name: o.fullName })}><ClipboardPen size={15} /> Record work</Button>}
                    {!past && o.attendance !== 'A' && <Button variant="ghost" onClick={() => setEditing({ workDate: date, operatorId: o.userId })}><Plus size={15} /> Add</Button>}
                  </div>
                )}
              >
                {mine.length === 0 ? (
                  <p className="text-sm text-ink-muted">{o.attendance === 'A' ? 'Absent on this day.' : 'No work given yet.'}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {mine.map((l) => (
                      <li key={l.assignId} className="rounded-lg border border-[#E6ECE8] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <WorkWhat line={l} />
                          <div className="flex">
                            {canEnter && <IconButton label="Record work done" onClick={() => setEntering({ operatorId: o.userId, name: o.fullName, assignId: l.assignId })}><ClipboardPen size={15} /></IconButton>}
                            {!past && <IconButton label="Change" onClick={() => setEditing({ ...l })}><Pencil size={15} /></IconButton>}
                            {!past && l.entries === 0 && <IconButton label="Remove" tone="danger" onClick={() => remove(l)}><Trash2 size={15} /></IconButton>}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                          <WorkDone line={l} />
                          <Progress pct={l.pct} level={l.level} compact />
                        </div>
                        {l.returned > 0 && (
                          <p className="mt-1.5 text-xs text-ink-muted">{fmt(l.returned)} bottles not done {l.returnedTo}.</p>
                        )}
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
      {entering && (
        <Modal title={`Record work · ${entering.name}`} onClose={() => setEntering(null)} wide>
          <p className="mb-3 text-sm text-ink-muted">For counts the operator reports at the end of the day. What you enter counts as checked.</p>
          <WorkEntryForm operatorId={entering.operatorId} date={date} assignId={entering.assignId} onCancel={() => setEntering(null)} onSaved={() => { setEntering(null); setMsg('Work saved.'); reload(); }} />
        </Modal>
      )}
    </>
  );
}

type Num = number | '';
const num = (v: string): Num => (v === '' ? '' : Math.max(0, Math.round(Number(v))));

function AssignForm({ initial, opts, onClose, onSaved }: { initial: Partial<AssignInput>; opts: AssignOptions; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const working = opts.operators.filter((o) => o.attendance !== 'A');
  const isEdit = initial.assignId !== undefined;
  const [operatorId, setOperatorId] = useState(initial.operatorId ?? working[0]?.userId ?? 0);
  const op = opts.operators.find((o) => o.userId === operatorId);
  const [areaPick, setAreaPick] = useState<number | null>(initial.areaId ?? null);
  const zone = op?.zones.find((z) => z.areaId === areaPick) ?? op?.zones[0];
  const [kindPick, setKindPick] = useState<WorkKind | null>(initial.kind ?? null);
  const kind: WorkKind = zone?.kinds.includes(kindPick as WorkKind) ? (kindPick as WorkKind) : zone?.kinds[0] ?? 'SUBCULTURE';
  // sub-culture
  const initBatch = opts.allBatches.find((b) => b.batchId === initial.batchId)?.batchCode ?? '';
  const initStage = initial.stageId ? opts.batches.flatMap((b) => b.stages).find((x) => x.stageId === initial.stageId)?.code ?? (initial as { stageCode?: string }).stageCode ?? '' : '';
  const [batchCode, setBatchCode] = useState(initBatch);
  const [stageCode, setStageCode] = useState(initStage);
  const [cropId, setCropId] = useState<number | null>(null);
  const batch = opts.batches.find((b) => sameCode(b.batchCode, batchCode));
  const stage = batch?.stages.find((x) => sameCode(x.code, stageCode));
  // bench
  const benches = opts.benches.filter((b) => b.areaId === zone?.areaId);
  const [benchId, setBenchId] = useState<number | null>(initial.benchId ?? null);
  // targets
  const [target, setTarget] = useState<Num>(initial.targetBottles ?? '');
  const [targetCont, setTargetCont] = useState<Num>(initial.targetContaminated ?? '');
  // media
  const [recipeId, setRecipeId] = useState<number | null>(initial.recipeId ?? opts.media[0]?.recipeId ?? null);
  const [code, setCode] = useState(initial.mediaBatchCode ?? opts.nextMediaBatchCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mineOld = isEdit && initial.kind === kind;
  const freeNow = (stage?.free ?? 0) + (mineOld && initial.batchId === batch?.batchId && initial.stageId === stage?.stageId ? initial.targetBottles ?? 0 : 0);
  const washFreePlain = Math.max(0, opts.wash.plain - opts.wash.givenPlain + (mineOld && kind === 'WASH' ? initial.targetBottles ?? 0 : 0));
  const washFreeCont = Math.max(0, opts.wash.contaminated - opts.wash.givenContaminated + (mineOld && kind === 'WASH' ? initial.targetContaminated ?? 0 : 0));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !zone) return;
    setBusy(true);
    setError('');
    try {
      await api.saveAssignment({
        assignId: initial.assignId, workDate: initial.workDate!, operatorId, kind, areaId: zone.areaId,
        batchId: null, stageId: null,
        ...(kind === 'SUBCULTURE' ? { batchCode, stageCode, cropId } : {}),
        benchId: benchId && benches.some((b) => b.benchId === benchId) ? benchId : null,
        targetBottles: target === '' ? 0 : target,
        targetContaminated: kind === 'WASH' ? (targetCont === '' ? 0 : targetCont) : undefined,
        recipeId: kind === 'MEDIA' ? recipeId : undefined,
        mediaBatchCode: kind === 'MEDIA' ? code : undefined,
      }, user);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const benchLabel = (b: AssignOptions['benches'][number]) => {
    const others = b.operatorIds.filter((id) => id !== operatorId).length;
    return `${b.code}${b.hood ? ` · ${others} of ${opts.maxPerHood} operators` : ''}`;
  };
  const benchFull = (b: AssignOptions['benches'][number]) => b.hood && b.operatorIds.filter((id) => id !== operatorId).length >= opts.maxPerHood;

  return (
    <Modal title={isEdit ? 'Change work' : 'Give work'} onClose={onClose} wide={kind === 'MEDIA'}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Operator">
            <Select value={operatorId} onChange={(e) => { setOperatorId(Number(e.target.value)); setAreaPick(null); setKindPick(null); }} disabled={isEdit}>
              {opts.operators.map((o) => <option key={o.userId} value={o.userId} disabled={o.attendance === 'A'}>{o.fullName}{o.attendance === 'A' ? ' (absent)' : o.attendance === 'HD' ? ' (half day)' : !o.attendance ? ' (not marked yet)' : ''}</option>)}
            </Select>
          </Field>
          <Field label="Zone" hint={op && op.zones.length > 1 ? 'This operator works in more than one zone.' : undefined}>
            <Select value={zone?.areaId ?? ''} onChange={(e) => { setAreaPick(Number(e.target.value)); setKindPick(null); setBenchId(null); }} disabled={!op || op.zones.length < 2}>
              {op?.zones.map((z) => <option key={z.areaId} value={z.areaId}>{z.name}</option>)}
            </Select>
          </Field>
        </div>
        {zone && zone.kinds.length > 1 && (
          <Field label="Work">
            <Select value={kind} onChange={(e) => setKindPick(e.target.value as WorkKind)}>
              {zone.kinds.map((k) => <option key={k} value={k}>{WORK_LABEL[k]}</option>)}
            </Select>
          </Field>
        )}

        {kind === 'SUBCULTURE' && (
          <BatchStageFields
            batchCode={batchCode}
            stageCode={stageCode}
            cropId={cropId}
            allBatches={opts.allBatches}
            known={opts.batches}
            stageCodes={opts.stageCodes}
            crops={opts.crops}
            onChange={(v) => {
              if (v.batchCode !== undefined) setBatchCode(v.batchCode);
              if (v.stageCode !== undefined) setStageCode(v.stageCode);
              if (v.cropId !== undefined) setCropId(v.cropId);
            }}
          />
        )}
        {kind === 'WASH' && <WashStatus plain={opts.wash.plain} contaminated={opts.wash.contaminated} givenPlain={opts.wash.givenPlain} givenContaminated={opts.wash.givenContaminated} addedPlain={opts.wash.addedPlain} addedContaminated={opts.wash.addedContaminated} />}
        {kind === 'MEDIA' && <MediaStatus media={opts.media} picked={recipeId} />}

        <Field label={kind === 'SUBCULTURE' ? 'Bench (hood)' : 'Bench'} hint={benches.some((b) => b.hood) ? `Optional. Each hood takes at most ${opts.maxPerHood} operators a day.` : 'Optional. Where the operator works.'}>
          <Select value={benchId ?? ''} onChange={(e) => setBenchId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Any bench</option>
            {benches.map((b) => <option key={b.benchId} value={b.benchId} disabled={benchFull(b)}>{benchLabel(b)}{benchFull(b) ? ' (full)' : ''}</option>)}
          </Select>
        </Field>

        {kind === 'SUBCULTURE' && (
          <Field label="Target (bottles to sub-culture)" hint={stage ? `${fmt(freeNow)} bottles of ${batch?.batchCode} at ${stage.code} not yet given to anyone on this day (${stage.trays} trays).` : batchCode.trim() && stageCode.trim() ? 'No bottles of this batch and stage are recorded yet, so there is no limit.' : undefined}>
            <Input type="number" min={1} max={stage ? freeNow : undefined} value={target} onChange={(e) => setTarget(num(e.target.value))} />
          </Field>
        )}
        {kind === 'WASH' && (
          <fieldset className="rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold">Target</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bottles to be washed" hint={`${fmt(washFreePlain)} not yet given out`}>
                <Input type="number" min={0} max={washFreePlain} value={target} onChange={(e) => setTarget(num(e.target.value))} autoFocus />
              </Field>
              <Field label="Contaminated bottles to be washed" hint={`${fmt(washFreeCont)} not yet given out`}>
                <Input type="number" min={0} max={washFreeCont} value={targetCont} onChange={(e) => setTargetCont(num(e.target.value))} />
              </Field>
            </div>
          </fieldset>
        )}
        {kind === 'MEDIA' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Batch code" hint="Given to the new media bottles">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="B0001/26" />
            </Field>
            <Field label="Media code">
              <Select value={recipeId ?? ''} onChange={(e) => setRecipeId(Number(e.target.value))}>
                {opts.media.map((m) => <option key={m.recipeId} value={m.recipeId}>{m.code} · {fmt(m.bottles)} ready</option>)}
              </Select>
            </Field>
            <Field label="Target (bottles to be made)">
              <Input type="number" min={1} value={target} onChange={(e) => setTarget(num(e.target.value))} autoFocus />
            </Field>
          </div>
        )}
        {(kind === 'QC_MEDIA' || kind === 'QC_CULTURE') && (
          <Field label={kind === 'QC_MEDIA' ? 'Target (media bottles to check)' : 'Target (culture bottles to check)'}>
            <Input type="number" min={1} value={target} onChange={(e) => setTarget(num(e.target.value))} autoFocus />
          </Field>
        )}

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
