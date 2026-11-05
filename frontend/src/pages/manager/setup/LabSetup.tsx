import { useState } from 'react';
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Badge, Button, Card, ErrorText, Field, FormActions, IconButton, Input, Modal, PageHeader, Select, Table, cn } from '../../../components/ui';
import { api, type New } from '../../../lib/api';
import { resetDb } from '../../../lib/store';
import { AREA_TYPE_LABEL, type Area, type AreaType, type Bench, type Lab } from '../../../lib/types';
import { useLoad } from '../../../lib/useLoad';
import { useSave } from '../../../lib/useSave';

/** Lab details, zones (areas) and the benches in each zone. Manager only. */
export default function LabSetup() {
  const { data, error, reload } = useLoad(() => Promise.all([api.getLab(), api.listAreas(), api.listBenches(), api.listUsers()]));
  const [selected, setSelected] = useState<number | null>(null);
  const [editLab, setEditLab] = useState(false);
  const [editArea, setEditArea] = useState<New<Area, 'areaId'> | null>(null);
  const [editBench, setEditBench] = useState<New<Bench, 'benchId'> | null>(null);
  const [actionError, setActionError] = useState('');

  if (!data) return <><PageHeader title="Lab, zones and benches" /><ErrorText>{error}</ErrorText>{!error && <p className="text-sm text-ink-muted">Loading…</p>}</>;
  const [lab, areas, benches, users] = data;
  const zone = areas.find((a) => a.areaId === (selected ?? areas[0]?.areaId));
  const zoneBenches = benches.filter((b) => b.areaId === zone?.areaId);
  const supervisorsOf = (areaId: number) => users.filter((u) => u.status === 'ACTIVE' && u.zoneIds.includes(areaId)).map((u) => u.fullName).join(', ');

  const remove = async (fn: () => Promise<void>, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setActionError('');
    try { await fn(); await reload(); } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not delete.'); }
  };

  return (
    <>
      <PageHeader
        title="Lab, zones and benches"
        subtitle="Set these up first. Every batch, tray and work entry is linked to a zone and a bench."
        actions={<Button variant="ghost" onClick={() => window.confirm('Throw away all changes and go back to the sample data?') && resetDb()}><RotateCcw size={16} /> Reset sample data</Button>}
      />
      <ErrorText>{actionError}</ErrorText>

      <Card title="Lab" action={<Button variant="secondary" onClick={() => setEditLab(true)}><Pencil size={15} /> Edit</Button>} className="mb-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-ink-muted">Name</dt><dd className="font-semibold">{lab.name}</dd></div>
          <div><dt className="text-ink-muted">Address</dt><dd>{lab.address || '—'}</dd></div>
          <div><dt className="text-ink-muted">Phone</dt><dd>{lab.phone || '—'}</dd></div>
        </dl>
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card
          title={`Zones (${areas.length})`}
          action={<Button onClick={() => setEditArea({ labId: lab.labId, name: '', areaType: 'INOCULATION', roomNo: '' })}><Plus size={16} /> Add zone</Button>}
          className="lg:col-span-3"
        >
          <Table
            rowKey={(a) => a.areaId}
            rows={areas}
            empty="No zones yet. Add the first one."
            columns={[
              {
                key: 'n', header: 'Zone', render: (a) => (
                  <button onClick={() => setSelected(a.areaId)} className={cn('text-left font-semibold hover:underline', a.areaId === zone?.areaId && 'text-forest-700')}>{a.name}</button>
                ),
              },
              { key: 't', header: 'Type', render: (a) => <Badge tone="blue">{AREA_TYPE_LABEL[a.areaType]}</Badge> },
              { key: 'r', header: 'Room', render: (a) => a.roomNo || '—' },
              { key: 'b', header: 'Benches', align: 'right', render: (a) => benches.filter((b) => b.areaId === a.areaId).length },
              { key: 's', header: 'Supervisor', render: (a) => supervisorsOf(a.areaId) || <span className="text-ink-muted">none</span> },
              {
                key: 'x', header: '', align: 'right', render: (a) => (
                  <div className="flex justify-end gap-1">
                    <IconButton label={`Edit ${a.name}`} onClick={() => setEditArea(a)}><Pencil size={16} /></IconButton>
                    <IconButton label={`Delete ${a.name}`} tone="danger" onClick={() => remove(() => api.deleteArea(a.areaId), `Delete zone "${a.name}"?`)}><Trash2 size={16} /></IconButton>
                  </div>
                ),
              },
            ]}
          />
        </Card>

        <Card
          title={zone ? `Benches in ${zone.name}` : 'Benches'}
          action={zone && <Button variant="secondary" onClick={() => setEditBench({ areaId: zone.areaId, code: '', capacityTrays: 20 })}><Plus size={16} /> Add bench</Button>}
          className="lg:col-span-2"
        >
          {!zone ? (
            <p className="text-sm text-ink-muted">Add a zone first.</p>
          ) : (
            <Table
              rowKey={(b) => b.benchId}
              rows={zoneBenches}
              empty="No benches in this zone yet."
              columns={[
                { key: 'c', header: 'Bench', render: (b) => <span className="font-semibold">{b.code}</span> },
                { key: 'k', header: 'Trays it holds', align: 'right', render: (b) => b.capacityTrays },
                {
                  key: 'x', header: '', align: 'right', render: (b) => (
                    <div className="flex justify-end gap-1">
                      <IconButton label={`Edit ${b.code}`} onClick={() => setEditBench(b)}><Pencil size={16} /></IconButton>
                      <IconButton label={`Delete ${b.code}`} tone="danger" onClick={() => remove(() => api.deleteBench(b.benchId), `Delete bench ${b.code}?`)}><Trash2 size={16} /></IconButton>
                    </div>
                  ),
                },
              ]}
            />
          )}
          <p className="mt-3 text-xs text-ink-muted">Click a zone name on the left to see its benches.</p>
        </Card>
      </div>

      {editLab && <LabForm lab={lab} onClose={() => setEditLab(false)} onSaved={reload} />}
      {editArea && <AreaForm area={editArea} onClose={() => setEditArea(null)} onSaved={reload} />}
      {editBench && zone && <BenchForm bench={editBench} zoneName={zone.name} onClose={() => setEditBench(null)} onSaved={reload} />}
    </>
  );
}

function LabForm({ lab, onClose, onSaved }: { lab: Lab; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(lab);
  const { busy, error, submit } = useSave(api.saveLab, onSaved, onClose);
  return (
    <Modal title="Edit lab" onClose={onClose}>
      <form onSubmit={(e) => submit(e, v)} className="flex flex-col gap-4">
        <Field label="Lab name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus /></Field>
        <Field label="Address"><Input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
        <Field label="Phone"><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}

function AreaForm({ area, onClose, onSaved }: { area: New<Area, 'areaId'>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(area);
  const { busy, error, submit } = useSave(api.saveArea, onSaved, onClose);
  return (
    <Modal title={area.areaId ? 'Edit zone' : 'Add zone'} onClose={onClose}>
      <form onSubmit={(e) => submit(e, v)} className="flex flex-col gap-4">
        <Field label="Zone name" hint="For example: Inoculation, Growth room 2"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus /></Field>
        <Field label="Type of work">
          <Select value={v.areaType} onChange={(e) => setV({ ...v, areaType: e.target.value as AreaType })}>
            {(Object.keys(AREA_TYPE_LABEL) as AreaType[]).map((t) => <option key={t} value={t}>{AREA_TYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="Room number or place"><Input value={v.roomNo} onChange={(e) => setV({ ...v, roomNo: e.target.value })} /></Field>
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save zone'}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}

function BenchForm({ bench, zoneName, onClose, onSaved }: { bench: New<Bench, 'benchId'>; zoneName: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(bench);
  const { busy, error, submit } = useSave(api.saveBench, onSaved, onClose);
  return (
    <Modal title={bench.benchId ? 'Edit bench' : `Add bench to ${zoneName}`} onClose={onClose}>
      <form onSubmit={(e) => submit(e, v)} className="flex flex-col gap-4">
        <Field label="Bench code" hint="Printed on the bench, for example LAF-7 or RACK-9"><Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} autoFocus /></Field>
        <Field label="How many trays it holds"><Input type="number" min={1} value={v.capacityTrays} onChange={(e) => setV({ ...v, capacityTrays: Number(e.target.value) })} /></Field>
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save bench'}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
