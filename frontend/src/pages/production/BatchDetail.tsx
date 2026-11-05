import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, GitBranch, MoveRight, Printer, Scissors, Bug } from 'lucide-react';
import { OverdueBadge, StageBadge } from '../../components/production/badges';
import { LossForm, MoveForm, SubcultureForm } from '../../components/production/TrayForms';
import { Badge, Button, Card, ErrorText, FormActions, Kpi, Modal, PageHeader, Table, Tabs, cn } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { basePath, fmt, fmtDate } from '../../lib/paths';
import type { TrayRow } from '../../lib/productionApi';
import { CAUSE_LABEL } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';

type Tab = 'trays' | 'history' | 'losses' | 'samples';

/** One batch: bottles by stage, its trays, stage history, losses and samples. */
export default function BatchDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const base = basePath(user);
  const batchId = Number(id);
  const { data, error, reload } = useLoad(() => Promise.all([user ? api.getBatch(batchId, user) : Promise.reject(new Error('Not logged in')), api.listCrops()]), [batchId, user]);
  const [tab, setTab] = useState<Tab>('trays');
  const [picked, setPicked] = useState<number[]>([]);
  const [action, setAction] = useState<null | { kind: 'sub' | 'loss'; tray: TrayRow } | { kind: 'move' } | { kind: 'split' }>(null);

  if (!data) return (
    <>
      <Link to={`${base}/batches`} className="mb-3 inline-flex items-center gap-1 text-sm text-forest-700"><ArrowLeft size={15} /> All batches</Link>
      <ErrorText>{error}</ErrorText>
      {!error && <p className="text-sm text-ink-muted">Loading…</p>}
    </>
  );

  const [{ batch, samples, trays, history, losses, children }, crops] = data;
  const growth = crops.find((c) => c.cropId === batch.cropId)?.defaultGrowth ?? 2.8;
  const isManager = user?.role === 'MANAGER';
  const pickedTrays = trays.filter((t) => picked.includes(t.trayId));
  const maxBottles = Math.max(1, ...batch.byStage.map((s) => s.bottles));
  const lossPct = batch.liveBottles + batch.lostBottles > 0 ? (100 * batch.lostBottles) / (batch.liveBottles + batch.lostBottles) : 0;
  const toggle = (id: number) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const done = () => { setPicked([]); reload(); };
  const printLabels = (ids: number[]) => navigate(`${base}/trays/labels?ids=${ids.join(',')}`);

  return (
    <>
      <Link to={`${base}/batches`} className="mb-3 inline-flex items-center gap-1 text-sm text-forest-700"><ArrowLeft size={15} /> All batches</Link>
      <PageHeader
        title={`Batch ${batch.batchCode}`}
        subtitle={
          <span>
            {batch.cropName} · started {fmtDate(batch.startDate)} ({batch.ageDays} days)
            {batch.parentCode && <> · split from <Link className="text-forest-700 underline" to={`${base}/batches/${batch.parentBatchId}`}>{batch.parentCode}</Link></>}
            {children.length > 0 && <> · parts: {children.map((c, i) => <span key={c.batchId}>{i > 0 && ', '}<Link className="text-forest-700 underline" to={`${base}/batches/${c.batchId}`}>{c.batchCode}</Link></span>)}</>}
          </span>
        }
        actions={batch.status === 'CLOSED' ? <Badge>Closed</Badge> : <Badge tone="green">Running</Badge>}
      />
      {!isManager && <p className="mb-4 rounded-lg bg-forest-50 px-3 py-2 text-sm text-[#2F4F3F]">You see only the trays of this batch that are in your zones.</p>}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Live bottles" value={fmt(batch.liveBottles)} />
        <Kpi label="Active trays" value={batch.activeTrays} note={batch.overdueTrays ? `${batch.overdueTrays} overdue` : undefined} />
        <Kpi label="Lost so far" value={fmt(batch.lostBottles)} note={`${lossPct.toFixed(1)}% of bottles`} />
        <Kpi label="Main stage" value={batch.mainStage} />
      </div>

      <Card title="Bottles in each stage" className="mb-5">
        {batch.byStage.length === 0 ? <p className="text-sm text-ink-muted">No active trays.</p> : (
          <div className="flex flex-col gap-2">
            {batch.byStage.map((s) => (
              <div key={s.stageCode} className="grid grid-cols-[3rem_1fr_7rem] items-center gap-3 text-sm">
                <StageBadge code={s.stageCode} />
                <div className="h-4 rounded bg-black/[0.04]"><div className="h-4 rounded bg-forest-500" style={{ width: `${(100 * s.bottles) / maxBottles}%` }} /></div>
                <span className="text-right tabular-nums">{fmt(s.bottles)} <span className="text-ink-muted">· {s.trays} trays</span></span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'trays', label: `Trays (${trays.length})` },
          { id: 'history', label: 'Stage history' },
          { id: 'losses', label: `Losses (${losses.length})` },
          { id: 'samples', label: 'Samples' },
        ]}
      />

      {tab === 'trays' && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-muted">{picked.length ? `${picked.length} selected` : 'Tick trays to move, split or print them.'}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="secondary" disabled={!trays.length} onClick={() => printLabels((picked.length ? picked : trays.map((t) => t.trayId)))}><Printer size={15} /> Print {picked.length ? 'selected' : 'all'} labels</Button>
              <Button variant="secondary" disabled={!picked.length} onClick={() => setAction({ kind: 'move' })}><MoveRight size={15} /> Move to bench</Button>
              {isManager && <Button variant="secondary" disabled={!picked.length || picked.length >= trays.length} onClick={() => setAction({ kind: 'split' })}><GitBranch size={15} /> Split into new part</Button>}
            </div>
          </div>
          <Table<TrayRow>
            rowKey={(t) => t.trayId}
            rows={trays}
            empty="No active trays."
            columns={[
              { key: 'p', header: '', render: (t) => <input type="checkbox" aria-label={`Select ${t.qrCode}`} checked={picked.includes(t.trayId)} onChange={() => toggle(t.trayId)} /> },
              { key: 'q', header: 'Tray', render: (t) => <span className="font-mono text-[13px] font-semibold">{t.qrCode}</span> },
              { key: 's', header: 'Stage', render: (t) => <StageBadge code={t.stageCode} /> },
              { key: 'b', header: 'Bench', render: (t) => <span>{t.benchCode} <span className="text-ink-muted">· {t.areaName}</span></span> },
              { key: 'n', header: 'Bottles', align: 'right', render: (t) => t.bottleCount },
              { key: 'd', header: 'In stage', align: 'right', render: (t) => <OverdueBadge level={t.overdue} days={t.daysInStage} /> },
              {
                key: 'x', header: '', align: 'right', render: (t) => (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" className="min-h-0 px-2 py-1" onClick={() => setAction({ kind: 'sub', tray: t })}><Scissors size={14} /> Sub-culture</Button>
                    <Button variant="ghost" className="min-h-0 px-2 py-1 text-redx-700" onClick={() => setAction({ kind: 'loss', tray: t })}><Bug size={14} /> Loss</Button>
                  </div>
                ),
              },
            ]}
          />
        </Card>
      )}

      {tab === 'history' && (
        <Card title="Stage changes">
          <Table
            rowKey={(m) => m.movementId}
            rows={history}
            empty="No stage changes recorded yet."
            columns={[
              { key: 'd', header: 'Date', render: (m) => fmtDate(m.movedAt) },
              { key: 'f', header: 'From → to', render: (m) => <span className="flex items-center gap-1"><StageBadge code={m.fromCode} /> → <StageBadge code={m.toCode} /></span> },
              { key: 'i', header: 'Bottles in', align: 'right', render: (m) => fmt(m.bottlesIn) },
              { key: 'l', header: 'Lost', align: 'right', render: (m) => (m.bottlesLost ? <span className="text-redx-700">{m.bottlesLost}</span> : 0) },
              { key: 'o', header: 'Bottles out', align: 'right', render: (m) => fmt(m.bottlesOut) },
              { key: 'g', header: 'Growth', align: 'right', render: (m) => `× ${(m.bottlesOut / Math.max(1, m.bottlesIn - m.bottlesLost)).toFixed(2)}` },
            ]}
          />
          <p className="mt-3 text-xs text-ink-muted">Growth = bottles out ÷ (bottles in − lost). The forecast uses this measured growth instead of the lab average.</p>
        </Card>
      )}

      {tab === 'losses' && (
        <Card title="Losses recorded">
          <Table
            rowKey={(l) => l.contId}
            rows={losses}
            empty="No losses recorded for this batch."
            columns={[
              { key: 'd', header: 'Found on', render: (l) => fmtDate(l.foundOn) },
              { key: 't', header: 'Tray', render: (l) => <span className="font-mono text-[13px]">{l.qrCode}</span> },
              { key: 's', header: 'Stage', render: (l) => <StageBadge code={l.stageCode} /> },
              { key: 'n', header: 'Bottles', align: 'right', render: (l) => <span className="text-redx-700">{l.bottlesLost}</span> },
              { key: 'c', header: 'Cause', render: (l) => CAUSE_LABEL[l.cause] },
              { key: 'r', header: 'Reported by', render: (l) => l.reportedByName },
            ]}
          />
        </Card>
      )}

      {tab === 'samples' && (
        <Card title="Samples from the mother plants">
          <Table
            rowKey={(s) => s.sampleId}
            rows={samples}
            empty={batch.parentCode ? `This part was split from ${batch.parentCode}; see its samples there.` : 'No samples recorded.'}
            columns={[
              { key: 't', header: 'Sample type', render: (s) => s.sampleType },
              { key: 'n', header: 'No. of samples', align: 'right', render: (s) => s.noOfSamples },
              { key: 'z', header: 'Sample size', align: 'right', render: (s) => s.sampleSize },
              { key: 'f', header: 'Source farm', render: (s) => s.sourceFarm || '—' },
              { key: 'd', header: 'Collected', render: (s) => fmtDate(s.collectedAt) },
            ]}
          />
        </Card>
      )}

      {action?.kind === 'sub' && <SubcultureForm tray={action.tray} growth={growth} onClose={() => setAction(null)} onSaved={done} />}
      {action?.kind === 'loss' && <LossForm tray={action.tray} onClose={() => setAction(null)} onSaved={done} />}
      {action?.kind === 'move' && <MoveForm trays={pickedTrays} onClose={() => setAction(null)} onSaved={done} />}
      {action?.kind === 'split' && <SplitForm code={batch.batchCode} trays={pickedTrays} batchId={batch.batchId} onClose={() => setAction(null)} onDone={(newId) => { setPicked([]); navigate(`${base}/batches/${newId}`); }} />}
    </>
  );
}

function SplitForm({ code, trays, batchId, onClose, onDone }: { code: string; trays: TrayRow[]; batchId: number; onClose: () => void; onDone: (id: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottles = trays.reduce((n, t) => n + t.bottleCount, 0);
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const child = await api.splitBatch(batchId, trays.map((t) => t.trayId));
      onDone(child.batchId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not split.');
      setBusy(false);
    }
  };
  return (
    <Modal title={`Split batch ${code}`} onClose={onClose}>
      <p className="text-sm">
        The <b>{trays.length} selected trays</b> ({fmt(bottles)} bottles) become a new part of this batch, for example to send them to rooting while the rest keeps multiplying.
        Both parts are then tracked separately, and the new part remembers it came from {code}.
      </p>
      <p className={cn('mt-3 text-sm text-ink-muted')}>Tray QR codes stay the same.</p>
      <ErrorText>{error}</ErrorText>
      <FormActions>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={go} disabled={busy}>{busy ? 'Splitting…' : 'Split batch'}</Button>
      </FormActions>
    </Modal>
  );
}
