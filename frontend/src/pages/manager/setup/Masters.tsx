import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, ErrorText, Field, FormActions, IconButton, Input, Modal, PageHeader, Select, Table, Tabs } from '../../../components/ui';
import { api, type New } from '../../../lib/api';
import { PHASE_LABEL, ROLE_LABEL, type AlertRule, type Crop, type MediaRecipe, type Phase, type Role, type Stage } from '../../../lib/types';
import { useLoad } from '../../../lib/useLoad';
import { useSave } from '../../../lib/useSave';

type Tab = 'crops' | 'stages' | 'media' | 'alerts';
const TABS: { id: Tab; label: string }[] = [
  { id: 'crops', label: 'Crops' },
  { id: 'stages', label: 'Stages' },
  { id: 'media', label: 'Media recipes' },
  { id: 'alerts', label: 'Alert limits' },
];
const PHASES = Object.keys(PHASE_LABEL) as Phase[];
const phaseTone = (p: Phase) => (p === 'INITIATION' ? 'purple' : p === 'MULTIPLICATION' ? 'green' : p === 'ROOTING' ? 'blue' : 'amber');

/** Lists that the rest of the system picks from. Manager only. */
export default function Masters() {
  const [tab, setTab] = useState<Tab>('crops');
  return (
    <>
      <PageHeader title="Crops, stages, media and limits" subtitle="Set once here; every other page picks from these lists." />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'crops' && <CropsTab />}
      {tab === 'stages' && <StagesTab />}
      {tab === 'media' && <MediaTab />}
      {tab === 'alerts' && <AlertsTab />}
    </>
  );
}

function useRemove(reload: () => void) {
  const [error, setError] = useState('');
  const remove = async (fn: () => Promise<void>, text: string) => {
    if (!window.confirm(text)) return;
    setError('');
    try { await fn(); reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete.'); }
  };
  return { error, remove };
}

function RowActions({ name, onEdit, onDelete }: { name: string; onEdit: () => void; onDelete?: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <IconButton label={`Edit ${name}`} onClick={onEdit}><Pencil size={16} /></IconButton>
      {onDelete && <IconButton label={`Delete ${name}`} tone="danger" onClick={onDelete}><Trash2 size={16} /></IconButton>}
    </div>
  );
}

function FormButtons({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  return (
    <FormActions>
      <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
    </FormActions>
  );
}

// ---------------- crops ----------------
function CropsTab() {
  const { data, error, reload } = useLoad(api.listCrops);
  const [edit, setEdit] = useState<New<Crop, 'cropId'> | null>(null);
  const del = useRemove(reload);
  return (
    <Card title="Crops and varieties" action={<Button onClick={() => setEdit({ name: '', variety: '', defaultGrowth: 2.8 })}><Plus size={16} /> Add crop</Button>}>
      <ErrorText>{error || del.error}</ErrorText>
      <Table
        rowKey={(c) => c.cropId}
        rows={data ?? []}
        empty={data ? 'No crops yet.' : 'Loading…'}
        columns={[
          { key: 'n', header: 'Crop', render: (c) => <span className="font-semibold">{c.name}</span> },
          { key: 'v', header: 'Variety', render: (c) => c.variety },
          { key: 'g', header: 'Growth per round (lab average)', align: 'right', render: (c) => `× ${c.defaultGrowth.toFixed(1)}` },
          { key: 'x', header: '', align: 'right', render: (c) => <RowActions name={`${c.name} ${c.variety}`} onEdit={() => setEdit(c)} onDelete={() => del.remove(() => api.deleteCrop(c.cropId), `Delete ${c.name} ${c.variety}?`)} /> },
        ]}
      />
      <p className="mt-3 text-xs text-ink-muted">Growth per round is used in the forecast until a batch has its own measured history (observed 2.2–3.0 in the lab).</p>
      {edit && <CropForm value={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </Card>
  );
}

function CropForm({ value, onClose, onSaved }: { value: New<Crop, 'cropId'>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(value);
  const { busy, error, submit } = useSave(api.saveCrop, onSaved, onClose);
  return (
    <Modal title={value.cropId ? 'Edit crop' : 'Add crop'} onClose={onClose}>
      <form onSubmit={(e) => submit(e, v)} className="flex flex-col gap-4">
        <Field label="Crop"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Banana" autoFocus /></Field>
        <Field label="Variety"><Input value={v.variety} onChange={(e) => setV({ ...v, variety: e.target.value })} placeholder="G-9 (Grand Naine)" /></Field>
        <Field label="Growth per multiplication round" hint="How many bottles one bottle becomes, on average">
          <Input type="number" step="0.1" min={1} max={6} value={v.defaultGrowth} onChange={(e) => setV({ ...v, defaultGrowth: Number(e.target.value) })} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <FormButtons busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}

// ---------------- stages ----------------
function StagesTab() {
  const { data, error, reload } = useLoad(api.listStages);
  const [edit, setEdit] = useState<New<Stage, 'stageId'> | null>(null);
  const del = useRemove(reload);
  const nextSeq = (data ?? []).reduce((m, s) => Math.max(m, s.seqNo), 0) + 1;
  return (
    <Card title="Stages, in order" action={<Button onClick={() => setEdit({ code: '', phase: 'MULTIPLICATION', seqNo: nextSeq, minDays: 30, maxDays: 45 })}><Plus size={16} /> Add stage</Button>}>
      <ErrorText>{error || del.error}</ErrorText>
      <Table
        rowKey={(s) => s.stageId}
        rows={data ?? []}
        empty={data ? 'No stages yet.' : 'Loading…'}
        columns={[
          { key: 'o', header: 'Order', align: 'right', render: (s) => s.seqNo },
          { key: 'c', header: 'Code', render: (s) => <span className="font-semibold">{s.code}</span> },
          { key: 'p', header: 'Phase', render: (s) => <Badge tone={phaseTone(s.phase)}>{PHASE_LABEL[s.phase]}</Badge> },
          { key: 'd', header: 'Normal time', align: 'right', render: (s) => `${s.minDays}–${s.maxDays} days` },
          { key: 'x', header: '', align: 'right', render: (s) => <RowActions name={s.code} onEdit={() => setEdit(s)} onDelete={() => del.remove(() => api.deleteStage(s.stageId), `Delete stage ${s.code}?`)} /> },
        ]}
      />
      <p className="mt-3 text-xs text-ink-muted">Trays are moved through stages in this order. Normal time is used for the ready date and the "tray overdue" alert.</p>
      {edit && <StageForm value={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </Card>
  );
}

function StageForm({ value, onClose, onSaved }: { value: New<Stage, 'stageId'>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(value);
  const { busy, error, submit } = useSave(api.saveStage, onSaved, onClose);
  return (
    <Modal title={value.stageId ? `Edit stage ${value.code}` : 'Add stage'} onClose={onClose}>
      <form onSubmit={(e) => submit(e, v)} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code"><Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="M9" autoFocus /></Field>
          <Field label="Order"><Input type="number" min={1} value={v.seqNo} onChange={(e) => setV({ ...v, seqNo: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Phase">
          <Select value={v.phase} onChange={(e) => setV({ ...v, phase: e.target.value as Phase })}>
            {PHASES.map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minimum days"><Input type="number" min={1} value={v.minDays} onChange={(e) => setV({ ...v, minDays: Number(e.target.value) })} /></Field>
          <Field label="Maximum days"><Input type="number" min={1} value={v.maxDays} onChange={(e) => setV({ ...v, maxDays: Number(e.target.value) })} /></Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <FormButtons busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}

// ---------------- media recipes ----------------
function MediaTab() {
  const { data, error, reload } = useLoad(api.listRecipes);
  const [edit, setEdit] = useState<New<MediaRecipe, 'recipeId'> | null>(null);
  const del = useRemove(reload);
  return (
    <Card title="Media recipes" action={<Button onClick={() => setEdit({ code: '', phase: 'MULTIPLICATION', shelfLifeDays: 3, notes: '' })}><Plus size={16} /> Add recipe</Button>}>
      <ErrorText>{error || del.error}</ErrorText>
      <Table
        rowKey={(r) => r.recipeId}
        rows={data ?? []}
        empty={data ? 'No recipes yet.' : 'Loading…'}
        columns={[
          { key: 'c', header: 'Code', render: (r) => <span className="font-semibold">{r.code}</span> },
          { key: 'p', header: 'Used for', render: (r) => <Badge tone={phaseTone(r.phase)}>{PHASE_LABEL[r.phase]}</Badge> },
          { key: 's', header: 'Usable for', align: 'right', render: (r) => `${r.shelfLifeDays} days` },
          { key: 'n', header: 'Notes', render: (r) => r.notes || <span className="text-ink-muted">—</span> },
          { key: 'x', header: '', align: 'right', render: (r) => <RowActions name={r.code} onEdit={() => setEdit(r)} onDelete={() => del.remove(() => api.deleteRecipe(r.recipeId), `Delete recipe ${r.code}?`)} /> },
        ]}
      />
      <p className="mt-3 text-xs text-ink-muted">A media lot older than its "usable for" days is blocked when scanned (media storage lock).</p>
      {edit && <RecipeForm value={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </Card>
  );
}

function RecipeForm({ value, onClose, onSaved }: { value: New<MediaRecipe, 'recipeId'>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(value);
  const { busy, error, submit } = useSave(api.saveRecipe, onSaved, onClose);
  return (
    <Modal title={value.recipeId ? `Edit recipe ${value.code}` : 'Add recipe'} onClose={onClose}>
      <form onSubmit={(e) => submit(e, v)} className="flex flex-col gap-4">
        <Field label="Code"><Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="MU4" autoFocus /></Field>
        <Field label="Used for">
          <Select value={v.phase} onChange={(e) => setV({ ...v, phase: e.target.value as Phase })}>
            {PHASES.map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
          </Select>
        </Field>
        <Field label="Usable for (days after preparation)"><Input type="number" min={1} value={v.shelfLifeDays} onChange={(e) => setV({ ...v, shelfLifeDays: Number(e.target.value) })} /></Field>
        <Field label="Notes"><Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="Optional" /></Field>
        <ErrorText>{error}</ErrorText>
        <FormButtons busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}

// ---------------- alert limits ----------------
function AlertsTab() {
  const { data, error, reload } = useLoad(api.listAlertRules);
  const [edit, setEdit] = useState<AlertRule | null>(null);
  return (
    <Card title="Alert limits">
      <ErrorText>{error}</ErrorText>
      <Table
        rowKey={(r) => r.ruleId}
        rows={data ?? []}
        empty="Loading…"
        columns={[
          { key: 'l', header: 'Alert', render: (r) => <span className="font-semibold">{r.label}</span> },
          { key: 'w', header: 'Warning when', align: 'right', render: (r) => <Badge tone="amber">{r.direction === 'ABOVE' ? '>' : '<'} {r.warnValue} {r.unit}</Badge> },
          { key: 'c', header: 'Critical when', align: 'right', render: (r) => (r.criticalValue === null ? '—' : <Badge tone="red">{r.direction === 'ABOVE' ? '>' : '<'} {r.criticalValue} {r.unit}</Badge>) },
          { key: 'n', header: 'Sent to', render: (r) => ROLE_LABEL[r.notifyRole] + (r.notifyRole === 'SUPERVISOR' ? ' of the zone' : '') },
          { key: 'x', header: '', align: 'right', render: (r) => <RowActions name={r.label} onEdit={() => setEdit(r)} /> },
        ]}
      />
      <p className="mt-3 text-xs text-ink-muted">Room limits follow the literature: about 21–27 °C suits most culture stages. The manager always gets critical alerts too.</p>
      {edit && <AlertRuleForm value={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </Card>
  );
}

function AlertRuleForm({ value, onClose, onSaved }: { value: AlertRule; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(value);
  const { busy, error, submit } = useSave(api.saveAlertRule, onSaved, onClose);
  const word = v.direction === 'ABOVE' ? 'above' : 'below';
  return (
    <Modal title={value.label} onClose={onClose}>
      <form onSubmit={(e) => submit(e, v)} className="flex flex-col gap-4">
        <Field label={`Warning when ${word} (${v.unit})`}><Input type="number" step="any" value={v.warnValue} onChange={(e) => setV({ ...v, warnValue: Number(e.target.value) })} autoFocus /></Field>
        <Field label={`Critical when ${word} (${v.unit})`} hint="Leave empty for no critical level">
          <Input type="number" step="any" value={v.criticalValue ?? ''} onChange={(e) => setV({ ...v, criticalValue: e.target.value === '' ? null : Number(e.target.value) })} />
        </Field>
        <Field label="Send to">
          <Select value={v.notifyRole} onChange={(e) => setV({ ...v, notifyRole: e.target.value as Role })}>
            <option value="SUPERVISOR">Supervisor of the zone (and manager)</option>
            <option value="MANAGER">Manager only</option>
          </Select>
        </Field>
        <ErrorText>{error}</ErrorText>
        <FormButtons busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}
