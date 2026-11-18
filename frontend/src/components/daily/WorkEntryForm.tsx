import { useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorText, Field, FormActions, Input, Select } from '../ui';
import { KindTag, MediaStatus, WashStatus } from './WorkBits';
import { BatchStageFields, sameCode } from './BatchStageFields';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { EntryRow, WorkInput } from '../../lib/dailyApi';
import { fmt } from '../../lib/paths';
import { CAUSE_LABEL, LOSS_TYPE_LABEL, WORK_LABEL, type LossCause, type LossType, type Phase, type WorkKind } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';

const CAUSES = Object.keys(CAUSE_LABEL) as LossCause[];
const TYPES = Object.keys(LOSS_TYPE_LABEL) as LossType[];
/** Number box value: '' while empty. */
type Num = number | '';
const num = (v: string): Num => (v === '' ? '' : Math.max(0, Math.round(Number(v))));
const n0 = (v: Num) => (v === '' ? 0 : v);

/**
 * Work done, typed in by hand: the same counts a QR scan gives, without scanning.
 * Sub-culture takes the bottles from that batch and stage's trays (oldest first) and makes the new trays.
 */
export function WorkEntryForm({ operatorId, date, assignId, onSaved, onCancel }: {
  operatorId: number;
  date: string;
  assignId?: number | null;
  onSaved: (e: EntryRow) => void;
  onCancel?: () => void;
}) {
  const { user } = useAuth();
  const { data: o, error: loadError } = useLoad(() => (user ? api.entryOptions(date, operatorId, user) : Promise.reject(new Error('Not logged in'))), [user, operatorId, date]);
  // Which line of work: an assignment id, or 'other' for work not given.
  const [lineKey, setLineKey] = useState<string>(assignId ? String(assignId) : '');
  const [areaId, setAreaId] = useState<number | null>(null);
  const [kind, setKind] = useState<WorkKind | null>(null);
  const [batchCode, setBatchCode] = useState('');
  const [stageCode, setStageCode] = useState('');
  const [cropId, setCropId] = useState<number | null>(null);
  const [handled, setHandled] = useState<Num>('');
  const [out, setOut] = useState<Num>('');
  const [lost, setLost] = useState<Num>(0);
  const [toStageId, setToStageId] = useState<number | null>(null);
  const [toBenchId, setToBenchId] = useState<number | null>(null);
  const [lotId, setLotId] = useState<number | null>(null);
  const [cause, setCause] = useState<LossCause>('OPERATOR');
  const [type, setType] = useState<LossType>('FUNGAL');
  const [cont, setCont] = useState<Num>(0);
  const [recipeId, setRecipeId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [litres, setLitres] = useState<Num>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Pick the first line of work once the options arrive.
  useEffect(() => {
    if (!o || lineKey) return;
    setLineKey(o.lines[0] ? String(o.lines[0].assignId) : 'other');
  }, [o, lineKey]);

  const line = o?.lines.find((l) => String(l.assignId) === lineKey) ?? null;
  const zone = o ? (line ? o.zones.find((z) => z.areaId === line.areaId) : o.zones.find((z) => z.areaId === areaId) ?? o.zones[0]) : undefined;
  const k: WorkKind = line?.kind ?? kind ?? zone?.kinds[0] ?? 'SUBCULTURE';
  // Batch and stage are typed (or come from the line of work given).
  const bCode = line?.kind === 'SUBCULTURE' ? line.batchCode : batchCode;
  const sCode = line?.kind === 'SUBCULTURE' ? line.stageCode : stageCode;
  const batch = o?.batches.find((b) => sameCode(b.batchCode, bCode));
  const fromStage = o?.stages.find((s) => sameCode(s.code, sCode));
  const sId = fromStage?.stageId ?? null;
  const stage = batch?.stages.find((s) => s.stageId === sId);
  const nextStage = o?.stages.find((s) => fromStage && s.seqNo > fromStage.seqNo);
  const toId = toStageId ?? nextStage?.stageId ?? sId;
  const toPhase = o?.stages.find((s) => s.stageId === toId)?.phase as Phase | undefined;
  const benchId = toBenchId ?? stage?.benchId ?? o?.benches[0]?.benchId ?? null;
  const rId = line?.recipeId ?? recipeId ?? o?.media[0]?.recipeId ?? null;
  const mediaCode = line?.mediaBatchCode ?? (code || o?.nextMediaBatchCode || '');
  const { data: lots } = useLoad(() => (k === 'SUBCULTURE' && (toPhase === 'MULTIPLICATION' || toPhase === 'ROOTING') ? api.usableLots(toPhase) : Promise.resolve([])), [k, toPhase]);

  const lineLeft = line ? Math.max(0, line.target - line.handled) : null;
  const expected = batch ? Math.round((n0(handled) - n0(lost)) * batch.growth) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !o) return;
    setBusy(true);
    setError('');
    const input: WorkInput = {
      operatorId, workDate: date, assignId: line?.assignId ?? null, kind: k, areaId: line?.areaId ?? zone?.areaId ?? null,
      bottlesHandled: k === 'WASH' ? n0(handled) + n0(cont) : n0(handled), note,
    };
    if (k === 'SUBCULTURE') {
      Object.assign(input, {
        ...(line ? {} : { batchCode, stageCode, cropId }), bottlesOut: n0(out), bottlesLost: n0(lost), toStageId: toId ?? undefined, toBenchId: benchId ?? undefined,
        mediaLotId: lots?.some((l) => l.mediaLotId === lotId) ? lotId : null, cause, contType: type,
      });
    } else if (k === 'WASH') {
      input.contaminated = n0(cont);
    } else if (k === 'MEDIA') {
      Object.assign(input, { recipeId: rId, mediaBatchCode: mediaCode, litres: litres === '' ? undefined : litres });
    } else {
      input.bottlesLost = n0(lost);
    }
    try {
      const row = await api.enterWork(input, user);
      onSaved(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  if (!o) return <><ErrorText>{loadError}</ErrorText>{!loadError && <p className="text-sm text-ink-muted">Loading…</p>}</>;
  if (o.operator.attendance === 'A') return <p className="rounded-lg bg-redx-100 px-3 py-2 text-sm text-redx-700">{o.operator.fullName} is marked absent on this day, so no work can be entered.</p>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Which work" hint={line ? `${fmt(line.handled)} of ${fmt(line.target)} done so far${lineLeft ? `, ${fmt(lineLeft)} left` : ''}.` : user?.role === 'OPERATOR' ? 'Work not given to you today. Your supervisor will see that.' : 'Work that was not given to this operator on this day.'}>
        <Select value={lineKey} onChange={(e) => setLineKey(e.target.value)}>
          {o.lines.map((l) => <option key={l.assignId} value={l.assignId}>{l.label} · {l.areaName}</option>)}
          <option value="other">Other work (not given)</option>
        </Select>
      </Field>

      {!line && (
        <div className="grid gap-3 sm:grid-cols-2">
          {o.zones.length > 1 && (
            <Field label="Zone">
              <Select value={zone?.areaId ?? ''} onChange={(e) => { setAreaId(Number(e.target.value)); setKind(null); }}>
                {o.zones.map((z) => <option key={z.areaId} value={z.areaId}>{z.name}</option>)}
              </Select>
            </Field>
          )}
          {zone && zone.kinds.length > 1 && (
            <Field label="Work">
              <Select value={k} onChange={(e) => setKind(e.target.value as WorkKind)}>
                {zone.kinds.map((x) => <option key={x} value={x}>{WORK_LABEL[x]}</option>)}
              </Select>
            </Field>
          )}
        </div>
      )}
      {line && <div><KindTag kind={k} /> <span className="text-sm text-ink-muted">in {line.areaName}</span></div>}

      {k === 'SUBCULTURE' && (
        <>
          <BatchStageFields
            batchCode={bCode}
            stageCode={sCode}
            cropId={cropId}
            disabled={!!line}
            allBatches={o.allBatches}
            known={o.batches.map((x) => ({ batchId: x.batchId, batchCode: x.batchCode, stages: x.stages }))}
            stageCodes={o.stages.map((x) => x.code)}
            crops={o.crops}
            onChange={(v) => {
              if (v.batchCode !== undefined) setBatchCode(v.batchCode);
              if (v.stageCode !== undefined) setStageCode(v.stageCode);
              if (v.cropId !== undefined) setCropId(v.cropId);
              setToStageId(null);
              setToBenchId(null);
            }}
          />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Bottles handled">
              <Input type="number" inputMode="numeric" min={1} max={stage?.bottles} value={handled} onChange={(e) => setHandled(num(e.target.value))} />
            </Field>
            <Field label="Bottles lost" hint="Contaminated">
              <Input type="number" inputMode="numeric" min={0} value={lost} onChange={(e) => setLost(num(e.target.value))} />
            </Field>
            <Field label="New bottles made" hint={n0(handled) && expected !== null ? `About ${fmt(expected)} expected` : undefined}>
              <Input type="number" inputMode="numeric" min={0} value={out} onChange={(e) => setOut(num(e.target.value))} />
            </Field>
          </div>
          {n0(lost) > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cause of loss"><Select value={cause} onChange={(e) => setCause(e.target.value as LossCause)}>{CAUSES.map((c) => <option key={c} value={c}>{CAUSE_LABEL[c]}</option>)}</Select></Field>
              <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as LossType)}>{TYPES.map((t) => <option key={t} value={t}>{LOSS_TYPE_LABEL[t]}</option>)}</Select></Field>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="New bottles go to stage">
              <Select value={toId ?? ''} onChange={(e) => setToStageId(Number(e.target.value))}>
                {o.stages.filter((s) => !fromStage || s.seqNo >= fromStage.seqNo).map((s) => <option key={s.stageId} value={s.stageId}>{s.code}{s.stageId === sId ? ' (same stage)' : ''}</option>)}
              </Select>
            </Field>
            <Field label="Rack for new trays">
              <Select value={benchId ?? ''} onChange={(e) => setToBenchId(Number(e.target.value))}>
                {o.benches.map((b) => <option key={b.benchId} value={b.benchId}>{b.code} · {b.areaName} ({b.trays}/{b.capacity})</option>)}
              </Select>
            </Field>
          </div>
          {lots && lots.length > 0 && (
            <Field label="Media lot used" hint="Optional. Which medium the new bottles were filled with.">
              <Select value={lots.some((l) => l.mediaLotId === lotId) ? lotId ?? '' : ''} onChange={(e) => setLotId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Not recorded</option>
                {lots.map((l) => <option key={l.mediaLotId} value={l.mediaLotId}>{l.recipeCode} · {l.lotCode} · {l.bottlesLeft} left</option>)}
              </Select>
            </Field>
          )}
          {n0(out) > 0 && (
            <p className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
              {stage ? <>Takes {fmt(n0(handled))} bottles from the oldest {batch?.batchCode} trays at {stage.code} and makes</> : <>No {bCode.toUpperCase() || 'batch'} bottles at {sCode.toUpperCase() || 'this stage'} are recorded yet, so none are taken from trays. This makes</>} <b>{Math.ceil(n0(out) / 30)} new tray{Math.ceil(n0(out) / 30) === 1 ? '' : 's'}</b> with new codes. The emptied bottles go to the wash area count.
            </p>
          )}
        </>
      )}

      {k === 'WASH' && (
        <>
          <WashStatus plain={o.wash.plain} contaminated={o.wash.contaminated} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bottles washed">
              <Input type="number" inputMode="numeric" min={0} max={o.wash.plain} value={handled} onChange={(e) => setHandled(num(e.target.value))} autoFocus />
            </Field>
            <Field label="Contaminated bottles washed">
              <Input type="number" inputMode="numeric" min={0} max={o.wash.contaminated} value={cont} onChange={(e) => setCont(num(e.target.value))} />
            </Field>
          </div>
        </>
      )}

      {k === 'MEDIA' && (
        <>
          <MediaStatus media={o.media} picked={rId} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Media code">
              <Select value={rId ?? ''} disabled={!!line} onChange={(e) => setRecipeId(Number(e.target.value))}>
                {o.media.map((m) => <option key={m.recipeId} value={m.recipeId}>{m.code}</option>)}
              </Select>
            </Field>
            <Field label="Batch code">
              <Input value={mediaCode} disabled={!!line} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field label="Bottles made">
              <Input type="number" inputMode="numeric" min={1} value={handled} onChange={(e) => setHandled(num(e.target.value))} autoFocus />
            </Field>
            <Field label="Litres made" hint="Optional">
              <Input type="number" inputMode="decimal" min={0} value={litres} onChange={(e) => setLitres(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))} />
            </Field>
          </div>
          <p className="text-xs text-ink-muted">The bottles are added to media batch {mediaCode || '—'}, ready to use until its shelf life runs out.</p>
        </>
      )}

      {(k === 'QC_MEDIA' || k === 'QC_CULTURE') && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={k === 'QC_MEDIA' ? 'Media bottles checked' : 'Culture bottles checked'}>
            <Input type="number" inputMode="numeric" min={1} value={handled} onChange={(e) => setHandled(num(e.target.value))} autoFocus />
          </Field>
          <Field label="Failed the check" hint={k === 'QC_CULTURE' ? 'Report the tray’s loss too, so it comes off stock.' : undefined}>
            <Input type="number" inputMode="numeric" min={0} value={lost} onChange={(e) => setLost(num(e.target.value))} />
          </Field>
        </div>
      )}

      <Field label="Note" hint="Optional">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <FormActions>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save work'}</Button>
      </FormActions>
    </form>
  );
}

