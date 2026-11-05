import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bug, MoveRight, Printer, Scissors, Search } from 'lucide-react';
import { QrScanner } from '../../components/daily/QrScanner';
import { OverdueBadge, StageBadge } from '../../components/production/badges';
import { LossForm, MoveForm, SubcultureForm } from '../../components/production/TrayForms';
import { Button, Card, ErrorText, Input, PageHeader, Select, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { basePath, fmt, fmtDate } from '../../lib/paths';
import type { TrayRow } from '../../lib/productionApi';
import { useLoad } from '../../lib/useLoad';

type Action = null | { kind: 'sub' | 'loss'; tray: TrayRow } | { kind: 'move'; trays: TrayRow[] };

/** All active trays (manager) or trays in own zones (supervisor). Find one by its QR code to act on it. */
export default function Trays() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const base = basePath(user);
  const { data, error, reload } = useLoad(() => (user ? Promise.all([api.listTrays(user), api.listCrops(), api.listBatches(user)]) : Promise.reject(new Error('Not logged in'))), [user]);
  const [code, setCode] = useState('');
  const [found, setFound] = useState<TrayRow | null>(null);
  const [findError, setFindError] = useState('');
  const [zone, setZone] = useState('');
  const [stage, setStage] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [action, setAction] = useState<Action>(null);

  const [trays, crops, batches] = data ?? [[], [], []];
  const zones = useMemo(() => [...new Set(trays.map((t) => t.areaName))].sort(), [trays]);
  const stages = useMemo(() => [...new Set(trays.map((t) => t.stageCode))], [trays]);
  const rows = trays.filter((t) => (!zone || t.areaName === zone) && (!stage || t.stageCode === stage) && (!overdueOnly || t.overdue !== 'OK'));
  const growthOf = (t: TrayRow) => {
    const cropId = batches.find((b) => b.batchId === t.batchId)?.cropId;
    return crops.find((c) => c.cropId === cropId)?.defaultGrowth ?? 2.8;
  };

  const lookUp = async (c: string) => {
    if (!user || !c.trim()) return;
    setFindError('');
    setFound(null);
    try { setFound(await api.getTrayByQr(c, user)); } catch (err) { setFindError(err instanceof Error ? err.message : 'Not found.'); }
  };
  const find = (e: FormEvent) => {
    e.preventDefault();
    lookUp(code);
  };
  const done = async () => {
    setPicked([]);
    await reload();
    if (found && user) api.getTrayByQr(found.qrCode, user).then(setFound).catch(() => setFound(null));
  };
  const toggle = (id: number) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  return (
    <>
      <PageHeader title={user?.role === 'MANAGER' ? 'Trays and QR labels' : 'Move trays'} subtitle="Every tray holds up to 30 bottles of one batch and one stage, and carries a QR label." />
      <ErrorText>{error}</ErrorText>

      <Card title="Find a tray" className="mb-5">
        <form onSubmit={find} className="flex flex-col gap-2 sm:flex-row">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Type the code on the label, e.g. B1-26-0004" className="font-mono" aria-label="Tray code" />
          <Button type="submit"><Search size={16} /> Find</Button>
        </form>
        <div className="mt-3 sm:max-w-xs"><QrScanner onScan={(c) => { setCode(c); lookUp(c); }} /></div>
        <ErrorText>{findError}</ErrorText>
        {found && (
          <div className="mt-4 rounded-xl border border-[#B9DCC7] bg-forest-50 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-lg font-bold">{found.qrCode}</span>
              <StageBadge code={found.stageCode} />
              <OverdueBadge level={found.overdue} days={found.daysInStage} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-ink-muted">Batch</dt><dd><Link className="font-semibold text-forest-700 underline" to={`${base}/batches/${found.batchId}`}>{found.batchCode}</Link></dd></div>
              <div><dt className="text-ink-muted">Bench</dt><dd className="font-semibold">{found.benchCode} · {found.areaName}</dd></div>
              <div><dt className="text-ink-muted">Bottles</dt><dd className="font-semibold">{found.bottleCount}</dd></div>
              <div><dt className="text-ink-muted">In this stage since</dt><dd className="font-semibold">{fmtDate(found.placedOn)}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => setAction({ kind: 'sub', tray: found })}><Scissors size={15} /> Sub-culture</Button>
              <Button variant="secondary" onClick={() => setAction({ kind: 'move', trays: [found] })}><MoveRight size={15} /> Move to bench</Button>
              <Button variant="secondary" className="text-redx-700" onClick={() => setAction({ kind: 'loss', tray: found })}><Bug size={15} /> Record loss</Button>
            </div>
          </div>
        )}
      </Card>

      <Card title={`Active trays (${fmt(rows.length)})`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select value={zone} onChange={(e) => setZone(e.target.value)} className="w-auto" aria-label="Zone">
            <option value="">All zones</option>
            {zones.map((z) => <option key={z}>{z}</option>)}
          </Select>
          <Select value={stage} onChange={(e) => setStage(e.target.value)} className="w-auto" aria-label="Stage">
            <option value="">All stages</option>
            {stages.map((s) => <option key={s}>{s}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm text-ink-muted"><input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only</label>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" disabled={!picked.length} onClick={() => navigate(`${base}/trays/labels?ids=${picked.join(',')}`)}><Printer size={15} /> Print labels</Button>
            <Button variant="secondary" disabled={!picked.length} onClick={() => setAction({ kind: 'move', trays: trays.filter((t) => picked.includes(t.trayId)) })}><MoveRight size={15} /> Move {picked.length || ''}</Button>
          </div>
        </div>
        <Table<TrayRow>
          rowKey={(t) => t.trayId}
          rows={rows}
          empty={data ? 'No trays match.' : 'Loading…'}
          columns={[
            {
              key: 'p', header: '', render: (t) => <input type="checkbox" aria-label={`Select ${t.qrCode}`} checked={picked.includes(t.trayId)} onChange={() => toggle(t.trayId)} />,
            },
            { key: 'q', header: 'Tray', render: (t) => <button className="font-mono text-[13px] font-semibold text-forest-700 hover:underline" onClick={() => { setCode(t.qrCode); setFound(t); setFindError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{t.qrCode}</button> },
            { key: 'b', header: 'Batch', render: (t) => <Link className="hover:underline" to={`${base}/batches/${t.batchId}`}>{t.batchCode}</Link> },
            { key: 's', header: 'Stage', render: (t) => <StageBadge code={t.stageCode} /> },
            { key: 'z', header: 'Bench', render: (t) => <span>{t.benchCode} <span className="text-ink-muted">· {t.areaName}</span></span> },
            { key: 'n', header: 'Bottles', align: 'right', render: (t) => t.bottleCount },
            { key: 'd', header: 'In stage', align: 'right', render: (t) => <OverdueBadge level={t.overdue} days={t.daysInStage} /> },
          ]}
        />
      </Card>

      {action?.kind === 'sub' && <SubcultureForm tray={action.tray} growth={growthOf(action.tray)} onClose={() => setAction(null)} onSaved={done} />}
      {action?.kind === 'loss' && <LossForm tray={action.tray} onClose={() => setAction(null)} onSaved={done} />}
      {action?.kind === 'move' && <MoveForm trays={action.trays} onClose={() => setAction(null)} onSaved={done} />}
    </>
  );
}
