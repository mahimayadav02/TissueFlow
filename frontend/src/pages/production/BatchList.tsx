import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { StageBadge } from '../../components/production/badges';
import { Badge, Button, Card, ErrorText, Field, FormActions, IconButton, Input, Kpi, Modal, PageHeader, Select, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import { basePath, fmt, fmtDate } from '../../lib/paths';
import type { BatchSummary } from '../../lib/productionApi';
import { useLoad } from '../../lib/useLoad';

/** All running batches. Manager sees every batch; supervisor sees batches with trays in own zones. */
export default function BatchList() {
  const { user } = useAuth();
  const [showClosed, setShowClosed] = useState(false);
  const { data, error, reload } = useLoad(() => (user ? api.listBatches(user, showClosed) : Promise.resolve([])), [user, showClosed]);
  const [adding, setAdding] = useState(false);
  const base = basePath(user);
  const isManager = user?.role === 'MANAGER';
  const rows = data ?? [];
  const live = rows.reduce((n, b) => n + b.liveBottles, 0);

  return (
    <>
      <PageHeader
        title="Batches"
        subtitle={isManager ? 'Every batch from samples to hardening. Click a batch code to see its trays and history.' : 'Batches that have trays in your zones. Counts show only your zones.'}
        actions={isManager && <Button onClick={() => setAdding(true)}><Plus size={16} /> New batch</Button>}
      />
      <ErrorText>{error}</ErrorText>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Running batches" value={rows.filter((b) => b.status === 'RUNNING').length} />
        <Kpi label="Live bottles" value={fmt(live)} />
        <Kpi label="Active trays" value={fmt(rows.reduce((n, b) => n + b.activeTrays, 0))} />
        <Kpi label="Overdue trays" value={rows.reduce((n, b) => n + b.overdueTrays, 0)} note="longer than allowed in one stage" />
      </div>
      <Card
        action={<label className="flex items-center gap-2 text-sm text-ink-muted"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed</label>}
        title="Batch list"
      >
        <Table<BatchSummary>
          rowKey={(b) => b.batchId}
          rows={rows}
          empty={data ? 'No batches yet.' : 'Loading…'}
          columns={[
            {
              key: 'c', header: 'Batch', render: (b) => (
                <div>
                  <Link to={`${base}/batches/${b.batchId}`} className="font-semibold text-forest-700 hover:underline">{b.batchCode}</Link>
                  {b.parentCode && <div className="text-xs text-ink-muted">split from {b.parentCode}</div>}
                </div>
              ),
            },
            { key: 'k', header: 'Crop', render: (b) => b.cropName },
            { key: 's', header: 'Stage(s)', render: (b) => <div className="flex flex-wrap gap-1">{b.byStage.length ? b.byStage.map((s) => <StageBadge key={s.stageCode} code={s.stageCode} />) : <Badge>none</Badge>}</div> },
            { key: 'l', header: 'Live bottles', align: 'right', render: (b) => fmt(b.liveBottles) },
            { key: 't', header: 'Trays', align: 'right', render: (b) => b.activeTrays },
            { key: 'x', header: 'Lost so far', align: 'right', render: (b) => fmt(b.lostBottles) },
            { key: 'a', header: 'Started', render: (b) => <span className="whitespace-nowrap">{fmtDate(b.startDate)} <span className="text-ink-muted">({b.ageDays} d)</span></span> },
            { key: 'o', header: '', render: (b) => (b.status === 'CLOSED' ? <Badge>Closed</Badge> : b.overdueTrays > 0 ? <Badge tone="amber">{b.overdueTrays} overdue</Badge> : null) },
          ]}
        />
      </Card>
      {adding && <NewBatchForm onClose={() => setAdding(false)} onSaved={reload} />}
    </>
  );
}

interface SampleDraft { sampleType: string; noOfSamples: number; sampleSize: number; sourceFarm: string }
const blankSample = (): SampleDraft => ({ sampleType: 'Sword sucker shoot tip', noOfSamples: 10, sampleSize: 3, sourceFarm: '' });

function NewBatchForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const navigate = useNavigate();
  const { data } = useLoad(() => Promise.all([api.listCrops(), api.listBenches(), api.listAreas()]));
  const [cropId, setCropId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState(today());
  const [samples, setSamples] = useState<SampleDraft[]>([blankSample()]);
  const [bottles, setBottles] = useState<number | ''>('');
  const [benchId, setBenchId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!data) return <Modal title="New batch" onClose={onClose}><p className="text-sm text-ink-muted">Loading…</p></Modal>;
  const [crops, benches, areas] = data;
  const incubation = benches.filter((b) => areas.find((a) => a.areaId === b.areaId)?.areaType === 'INCUBATION');
  const crop = cropId ?? crops[0]?.cropId ?? 0;
  const bench = benchId ?? incubation[0]?.benchId ?? benches[0]?.benchId ?? 0;
  const explants = samples.reduce((n, s) => n + s.noOfSamples * s.sampleSize, 0);
  const d = new Date(startDate);
  const code = `B${d.getMonth() + 1}-${String(d.getFullYear()).slice(2)}`;
  const set = (i: number, patch: Partial<SampleDraft>) => setSamples(samples.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const b = await api.createBatch({
        cropId: crop, startDate, bottles: bottles === '' ? explants : bottles, benchId: bench,
        samples: samples.map((s) => ({ ...s, collectedAt: `${startDate}T09:00:00` })),
      });
      onSaved();
      onClose();
      navigate(`/m/batches/${b.batchId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the batch.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New batch" onClose={onClose} wide>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Crop"><Select value={crop} onChange={(e) => setCropId(Number(e.target.value))}>{crops.map((c) => <option key={c.cropId} value={c.cropId}>{c.name} {c.variety}</option>)}</Select></Field>
          <Field label="Start date"><Input type="date" max={today()} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label="Batch code" hint="From the month; a letter is added if it already exists"><Input value={code} disabled /></Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Samples from the mother plants</span>
            <Button type="button" variant="ghost" onClick={() => setSamples([...samples, blankSample()])}><Plus size={15} /> Add sample</Button>
          </div>
          <div className="flex flex-col gap-3">
            {samples.map((s, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[2fr_1fr_1fr_2fr_auto] sm:items-end">
                <Field label="Sample type"><Input value={s.sampleType} onChange={(e) => set(i, { sampleType: e.target.value })} /></Field>
                <Field label="No. of samples"><Input type="number" min={1} value={s.noOfSamples} onChange={(e) => set(i, { noOfSamples: Number(e.target.value) })} /></Field>
                <Field label="Sample size"><Input type="number" min={1} value={s.sampleSize} onChange={(e) => set(i, { sampleSize: Number(e.target.value) })} /></Field>
                <Field label="Source farm"><Input value={s.sourceFarm} onChange={(e) => set(i, { sourceFarm: e.target.value })} placeholder="Farm, village" /></Field>
                <IconButton label="Remove sample" tone="danger" type="button" disabled={samples.length === 1} onClick={() => setSamples(samples.filter((_, k) => k !== i))}><Trash2 size={16} /></IconButton>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bottles inoculated (stage I1)" hint={`Leave empty to use samples × size = ${explants}`}>
            <Input type="number" min={1} value={bottles} onChange={(e) => setBottles(e.target.value === '' ? '' : Number(e.target.value))} placeholder={String(explants)} />
          </Field>
          <Field label="Place trays on bench">
            <Select value={bench} onChange={(e) => setBenchId(Number(e.target.value))}>
              {benches.map((b) => <option key={b.benchId} value={b.benchId}>{b.code} · {areas.find((a) => a.areaId === b.areaId)?.name}</option>)}
            </Select>
          </Field>
        </div>
        <p className="text-sm text-ink-muted">The system makes trays of up to 30 bottles and gives each a QR code. You can print the labels on the next page.</p>
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create batch'}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
