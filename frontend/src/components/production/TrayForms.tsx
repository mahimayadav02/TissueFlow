import { useMemo, useState, type FormEvent } from 'react';
import { Button, ErrorText, Field, FormActions, Input, Modal, Select } from '../ui';
import { api } from '../../lib/api';
import { today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import { fmt } from '../../lib/paths';
import { visibleAreas, type TrayRow } from '../../lib/productionApi';
import { CAUSE_LABEL, LOSS_TYPE_LABEL, type LossCause, type LossType, type Tray } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';

const CAUSES = Object.keys(CAUSE_LABEL) as LossCause[];
const TYPES = Object.keys(LOSS_TYPE_LABEL) as LossType[];

/** Stages, benches the user may use, crops and how full each bench is. */
function useSetup(extraAreaId: number | null = null) {
  const { user } = useAuth();
  const { data } = useLoad(() => Promise.all([api.listStages(), api.listBenches(), api.listAreas(), api.listCrops(), api.benchLoad()]));
  return useMemo(() => {
    if (!data || !user) return null;
    const [stages, benches, areas, crops, load] = data;
    const allowed = visibleAreas(user);
    // The tray's own zone is always allowed, so new trays can go back to the rack they came from.
    const myBenches = benches.filter((b) => allowed === null || allowed.includes(b.areaId) || b.areaId === extraAreaId);
    const areaName = (id: number) => areas.find((a) => a.areaId === id)?.name ?? '';
    return { stages, benches: myBenches, areaName, crops, load };
  }, [data, user, extraAreaId]);
}

function BenchSelect({ value, onChange, setup, extraTrays = 0 }: { value: number; onChange: (id: number) => void; setup: NonNullable<ReturnType<typeof useSetup>>; extraTrays?: number }) {
  const bench = setup.benches.find((b) => b.benchId === value);
  const after = bench ? (setup.load[bench.benchId] ?? 0) + extraTrays : 0;
  return (
    <Field label="Bench" hint={bench ? `${after} of ${bench.capacityTrays} trays after this${after > bench.capacityTrays ? ' — bench will be over capacity' : ''}` : undefined}>
      <Select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {setup.benches.map((b) => (
          <option key={b.benchId} value={b.benchId}>{b.code} · {setup.areaName(b.areaId)} ({setup.load[b.benchId] ?? 0}/{b.capacityTrays})</option>
        ))}
      </Select>
    </Field>
  );
}

function TrayInfo({ tray }: { tray: TrayRow }) {
  return (
    <div className="mb-4 grid grid-cols-3 gap-2 rounded-lg bg-forest-50 p-3 text-sm">
      <div><div className="text-xs text-ink-muted">Batch</div><div className="font-semibold">{tray.batchCode}</div></div>
      <div><div className="text-xs text-ink-muted">Stage · bench</div><div className="font-semibold">{tray.stageCode} · {tray.benchCode}</div></div>
      <div><div className="text-xs text-ink-muted">Bottles now</div><div className="font-semibold">{tray.bottleCount}</div></div>
    </div>
  );
}

/** Sub-culture a tray: its bottles become new bottles at the next (or same) stage, in new trays of up to 30. */
export function SubcultureForm({ tray, growth, onClose, onSaved }: { tray: TrayRow; growth: number; onClose: () => void; onSaved: (made: Tray[]) => void }) {
  const { user } = useAuth();
  const setup = useSetup(tray.areaId);
  const current = setup?.stages.find((s) => s.stageId === tray.stageId);
  const next = setup?.stages.find((s) => current && s.seqNo > current.seqNo);
  const [toStageId, setToStageId] = useState<number | null>(null);
  const [toBenchId, setToBenchId] = useState<number | null>(null);
  const [lost, setLost] = useState(0);
  const [out, setOut] = useState<number | ''>('');
  const [cause, setCause] = useState<LossCause>('OPERATOR');
  const [type, setType] = useState<LossType>('FUNGAL');
  const [lotId, setLotId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Media lots that can fill bottles for the stage the new bottles go to.
  const targetPhase = setup?.stages.find((s) => s.stageId === (toStageId ?? next?.stageId ?? current?.stageId))?.phase;
  const { data: lots } = useLoad(() => (targetPhase === 'MULTIPLICATION' || targetPhase === 'ROOTING' ? api.usableLots(targetPhase) : Promise.resolve([])), [targetPhase]);

  if (!setup || !current) return <Modal title={`Sub-culture ${tray.qrCode}`} onClose={onClose}><p className="text-sm text-ink-muted">Loading…</p></Modal>;
  const stageId = toStageId ?? next?.stageId ?? current.stageId;
  const benchId = toBenchId ?? tray.benchId;
  const expected = Math.round((tray.bottleCount - lost) * growth);
  const outN = out === '' ? 0 : out;
  const newTrays = Math.ceil(outN / 30);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      const made = await api.subcultureTray({ trayId: tray.trayId, toStageId: stageId, toBenchId: benchId, bottlesOut: outN, bottlesLost: lost, cause, contType: type, mediaLotId: lots?.some((l) => l.mediaLotId === lotId) ? lotId : null }, user);
      onSaved(made);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Sub-culture ${tray.qrCode}`} onClose={onClose}>
      <TrayInfo tray={tray} />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="New bottles go to stage">
          <Select value={stageId} onChange={(e) => setToStageId(Number(e.target.value))}>
            {setup.stages.filter((s) => s.seqNo >= current.seqNo).map((s) => <option key={s.stageId} value={s.stageId}>{s.code}{s.stageId === current.stageId ? ' (same stage)' : ''}</option>)}
          </Select>
        </Field>
        <BenchSelect value={benchId} onChange={setToBenchId} setup={setup} extraTrays={newTrays} />
        {lots && lots.length > 0 && (
          <Field label="Media lot used" hint="Which medium the new bottles were filled with, so media problems can be traced.">
            <Select value={lots.some((l) => l.mediaLotId === lotId) ? lotId ?? '' : ''} onChange={(e) => setLotId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Not recorded</option>
              {lots.map((l) => <option key={l.mediaLotId} value={l.mediaLotId}>{l.lotCode} · {l.bottlesLeft} bottles left · use by {l.expiresOn.slice(8, 10)}/{l.expiresOn.slice(5, 7)}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bottles lost" hint="Contaminated, thrown away">
            <Input type="number" min={0} max={tray.bottleCount} value={lost} onChange={(e) => setLost(Math.max(0, Number(e.target.value)))} />
          </Field>
          <Field label="New bottles made" hint={`Expected about ${fmt(expected)} (× ${growth.toFixed(1)})`}>
            <Input type="number" min={0} value={out} onChange={(e) => setOut(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))} autoFocus />
          </Field>
        </div>
        {lost > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cause of loss"><Select value={cause} onChange={(e) => setCause(e.target.value as LossCause)}>{CAUSES.map((c) => <option key={c} value={c}>{CAUSE_LABEL[c]}</option>)}</Select></Field>
            <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as LossType)}>{TYPES.map((t) => <option key={t} value={t}>{LOSS_TYPE_LABEL[t]}</option>)}</Select></Field>
          </div>
        )}
        {outN > 0 && (
          <p className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
            Growth this round: <b>× {((outN) / Math.max(1, tray.bottleCount - lost)).toFixed(2)}</b> · creates <b>{newTrays} new tray{newTrays === 1 ? '' : 's'}</b> with new QR labels.
          </p>
        )}
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save sub-culture'}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}

/** Record contaminated or dead bottles in a tray, with the cause. */
export function LossForm({ tray, onClose, onSaved }: { tray: TrayRow; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [lost, setLost] = useState(1);
  const [cause, setCause] = useState<LossCause>('OPERATOR');
  const [type, setType] = useState<LossType>('FUNGAL');
  const [foundOn, setFoundOn] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      await api.recordLoss({ trayId: tray.trayId, bottlesLost: lost, cause, contType: type, foundOn, note }, user);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Record loss in ${tray.qrCode}`} onClose={onClose}>
      <TrayInfo tray={tray} />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bottles lost"><Input type="number" min={1} max={tray.bottleCount} value={lost} onChange={(e) => setLost(Number(e.target.value))} autoFocus /></Field>
          <Field label="Found on"><Input type="date" max={today()} value={foundOn} onChange={(e) => setFoundOn(e.target.value)} /></Field>
        </div>
        <Field label="Cause"><Select value={cause} onChange={(e) => setCause(e.target.value as LossCause)}>{CAUSES.map((c) => <option key={c} value={c}>{CAUSE_LABEL[c]}</option>)}</Select></Field>
        <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as LossType)}>{TYPES.map((t) => <option key={t} value={t}>{LOSS_TYPE_LABEL[t]}</option>)}</Select></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. near the door" /></Field>
        {lost === tray.bottleCount && <p className="rounded-lg bg-amberx-100 px-3 py-2 text-sm text-amberx-700">All bottles lost: the tray will be closed.</p>}
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} variant="danger">{busy ? 'Saving…' : 'Record loss'}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}

/** Move one or more trays to another bench (same stage). */
export function MoveForm({ trays, onClose, onSaved }: { trays: TrayRow[]; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const setup = useSetup();
  const [benchId, setBenchId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!setup) return <Modal title="Move trays" onClose={onClose}><p className="text-sm text-ink-muted">Loading…</p></Modal>;
  const target = benchId ?? setup.benches[0]?.benchId ?? 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      await api.moveTrays(trays.map((t) => t.trayId), target, user);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Move ${trays.length} tray${trays.length === 1 ? '' : 's'}`} onClose={onClose}>
      <p className="mb-4 text-sm text-ink-muted">{trays.slice(0, 6).map((t) => t.qrCode).join(', ')}{trays.length > 6 ? ` and ${trays.length - 6} more` : ''}</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <BenchSelect value={target} onChange={setBenchId} setup={setup} extraTrays={trays.filter((t) => t.benchId !== target).length} />
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Moving…' : 'Move'}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
