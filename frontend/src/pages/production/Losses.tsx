import { useMemo, useState, type FormEvent } from 'react';
import { Bug, Search } from 'lucide-react';
import { StageBadge } from '../../components/production/badges';
import { LossForm } from '../../components/production/TrayForms';
import { Button, Card, ErrorText, Field, FormActions, Input, Kpi, Modal, PageHeader, Select, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmt, fmtDate } from '../../lib/paths';
import type { LossRow, TrayRow } from '../../lib/productionApi';
import { CAUSE_LABEL, LOSS_TYPE_LABEL, type LossCause } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';

const PERIODS = [
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 3650, label: 'All time' },
];

/** Contamination and other losses: where, when and why bottles are lost. */
export default function Losses() {
  const { user } = useAuth();
  const { data, error, reload } = useLoad(() => (user ? Promise.all([api.listLosses(user), api.handledByStage()]) : Promise.reject(new Error('Not logged in'))), [user]);
  const [period, setPeriod] = useState(30);
  const [adding, setAdding] = useState(false);
  const [tray, setTray] = useState<TrayRow | null>(null);

  const [all, handled] = data ?? [[], {} as Record<string, number>];
  const since = new Date(Date.now() - period * 86_400_000).toISOString().slice(0, 10);
  const rows = all.filter((r) => r.foundOn >= since);
  const total = rows.reduce((n, r) => n + r.bottlesLost, 0);

  const group = useMemo(() => (key: (r: LossRow) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.bottlesLost);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const byCause = group((r) => r.cause);
  const byStage = group((r) => r.stageCode);
  const byZone = group((r) => r.areaName);
  const top = byCause[0];

  return (
    <>
      <PageHeader
        title="Contamination and losses"
        subtitle="Every lost bottle is recorded against its tray, so losses can be traced to stage, zone, operator and cause."
        actions={<Button variant="danger" onClick={() => setAdding(true)}><Bug size={16} /> Record loss</Button>}
      />
      <ErrorText>{error}</ErrorText>
      <div className="mb-4 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button key={p.days} onClick={() => setPeriod(p.days)} className={`focus-ring rounded-full border px-3 py-1.5 text-sm ${period === p.days ? 'border-forest-700 bg-forest-700 text-white' : 'border-[#C6BFB0] bg-white'}`}>{p.label}</button>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Bottles lost" value={fmt(total)} />
        <Kpi label="Loss records" value={rows.length} />
        <Kpi label="Main cause" value={top ? CAUSE_LABEL[top[0] as LossCause].split(' ')[0] : '—'} note={top && total ? `${Math.round((100 * top[1]) / total)}% of lost bottles` : undefined} />
        <Kpi label="Worst stage" value={byStage[0]?.[0] ?? '—'} note={byStage[0] ? `${byStage[0][1]} bottles` : undefined} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Bars title="By cause" rows={byCause.map(([k, v]) => [CAUSE_LABEL[k as LossCause], v])} />
        <Bars title="By stage" rows={byStage.map(([k, v]) => [k, v])} note={(k) => (handled[k] ? `${((100 * (byStage.find((x) => x[0] === k)?.[1] ?? 0)) / handled[k]).toFixed(1)}% of handled` : '')} />
        <Bars title="By zone" rows={byZone.map(([k, v]) => [k, v])} />
      </div>

      <Card title="Loss records">
        <Table<LossRow>
          rowKey={(r) => r.contId}
          rows={rows}
          empty={data ? 'No losses in this period.' : 'Loading…'}
          columns={[
            { key: 'd', header: 'Found on', render: (r) => <span className="whitespace-nowrap">{fmtDate(r.foundOn)}</span> },
            { key: 't', header: 'Tray', render: (r) => <span className="font-mono text-[13px]">{r.qrCode}</span> },
            { key: 'b', header: 'Batch', render: (r) => r.batchCode },
            { key: 's', header: 'Stage', render: (r) => <StageBadge code={r.stageCode} /> },
            { key: 'z', header: 'Zone', render: (r) => r.areaName },
            { key: 'n', header: 'Bottles', align: 'right', render: (r) => <span className="font-semibold text-redx-700">{r.bottlesLost}</span> },
            { key: 'c', header: 'Cause', render: (r) => CAUSE_LABEL[r.cause] },
            { key: 'y', header: 'Type', render: (r) => LOSS_TYPE_LABEL[r.contType].split(' ')[0] },
            { key: 'r', header: 'By', render: (r) => r.reportedByName },
            { key: 'o', header: 'Note', render: (r) => r.note || <span className="text-ink-muted">—</span> },
          ]}
        />
      </Card>

      {adding && <FindTray onClose={() => setAdding(false)} onFound={(t) => { setAdding(false); setTray(t); }} />}
      {tray && <LossForm tray={tray} onClose={() => setTray(null)} onSaved={reload} />}
    </>
  );
}

function Bars({ title, rows, note }: { title: string; rows: [string, number][]; note?: (key: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <Card title={title}>
      {rows.length === 0 ? <p className="text-sm text-ink-muted">No losses.</p> : (
        <ul className="flex flex-col gap-2.5">
          {rows.map(([k, v]) => (
            <li key={k} className="text-sm">
              <div className="mb-1 flex justify-between gap-2"><span className="truncate">{k}</span><span className="tabular-nums font-semibold">{v}</span></div>
              <div className="h-2.5 rounded bg-black/[0.04]"><div className="h-2.5 rounded bg-[#D9826F]" style={{ width: `${(100 * v) / max}%` }} /></div>
              {note?.(k) && <div className="mt-0.5 text-xs text-ink-muted">{note(k)}</div>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FindTray({ onClose, onFound }: { onClose: () => void; onFound: (t: TrayRow) => void }) {
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');
    try { onFound(await api.getTrayByQr(code, user)); } catch (err) { setError(err instanceof Error ? err.message : 'Not found.'); }
  };
  return (
    <Modal title="Which tray?" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Tray code (on the QR label)"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="B1-26-0004" className="font-mono" autoFocus /></Field>
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit"><Search size={16} /> Find tray</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
