import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { BarChart } from '../../components/charts/BarChart';
import { EntryBadge, Progress } from '../../components/daily/bits';
import { KindTag } from '../../components/daily/WorkBits';
import { Button, Card, ErrorText, Field, Input, Kpi, PageHeader, Select, Table, Tabs } from '../../components/ui';
import { api } from '../../lib/api';
import { addDays, today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import { downloadCsv } from '../../lib/csv';
import type { EntryRow, OutputFilter, OutputGroup } from '../../lib/dailyApi';
import { fmt, fmtDate } from '../../lib/paths';
import { WORK_LABEL, type WorkKind } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';
import { HELP } from '../../config/pageHelp';

type Tab = 'day' | 'operator' | 'zone' | 'kind' | 'batch' | 'stage' | 'entries';
const PERIODS = [
  { id: 'today', label: 'Today', from: () => today(), to: () => today() },
  { id: 'yesterday', label: 'Yesterday', from: () => addDays(today(), -1), to: () => addDays(today(), -1) },
  { id: '7', label: 'Last 7 days', from: () => addDays(today(), -6), to: () => today() },
  { id: '30', label: 'Last 30 days', from: () => addDays(today(), -29), to: () => today() },
] as const;
const dayName = (d: string) => (d === today() ? 'Today' : new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }));

/**
 * Work done, added up. One day's (or a period's) total for every kind of work combined, then split by
 * day, operator, zone, kind of work, batch and stage. Click any row to filter by it.
 * `mine`: the operator's own "My work" page (no operator filter).
 */
export default function WorkOutput({ mine = false }: { mine?: boolean }) {
  const { user } = useAuth();
  const [f, setF] = useState<OutputFilter>({ from: addDays(today(), mine ? -6 : 0), to: today() });
  const [tab, setTab] = useState<Tab>(mine ? 'day' : 'operator');
  const { data, error } = useLoad(() => (user ? api.workOutput(user, f) : Promise.reject(new Error('Not logged in'))), [user, JSON.stringify(f)]);
  if (!user) return null;
  const set = (p: Partial<OutputFilter>) => setF((x) => ({ ...x, ...p }));
  const o = data?.options;
  const t = data?.totals;
  const pct = t && t.target ? Math.round((100 * t.handled) / t.target) : null;
  const period = PERIODS.find((p) => p.from() === f.from && p.to() === f.to)?.id ?? 'custom';
  const filtered = !!(f.operatorId || f.areaId || f.kind || f.batchId || f.stageId);

  // A short sentence of what is being shown, e.g. "Lakshmi · Washing · last 7 days".
  const parts = [
    f.operatorId && o?.operators.find((x) => x.userId === f.operatorId)?.fullName,
    f.areaId && o?.zones.find((x) => x.areaId === f.areaId)?.name,
    f.kind && WORK_LABEL[f.kind],
    f.batchId && o?.batches.find((x) => x.batchId === f.batchId)?.batchCode,
    f.stageId && `stage ${o?.stages.find((x) => x.stageId === f.stageId)?.code ?? ''}`,
  ].filter(Boolean);
  const when = f.from === f.to ? dayName(f.from) : `${fmtDate(f.from)} to ${fmtDate(f.to)}`;

  const groupCols = (first: string, onPick?: (g: OutputGroup) => void) => [
    {
      key: 'l', header: first, render: (g: OutputGroup) => onPick
        ? <button className="font-semibold text-forest-700 hover:underline" onClick={() => onPick(g)} title="Show only this">{g.label}</button>
        : <span className="font-semibold">{g.label}</span>,
    },
    { key: 't', header: 'Target', align: 'right' as const, render: (g: OutputGroup) => (g.target ? fmt(g.target) : '—') },
    { key: 'h', header: 'Done', align: 'right' as const, render: (g: OutputGroup) => <b className="tabular-nums">{fmt(g.handled)}</b> },
    { key: 'p', header: '% of target', render: (g: OutputGroup) => <Progress pct={g.pct} level="NONE" compact /> },
    { key: 'n', header: 'New bottles', align: 'right' as const, render: (g: OutputGroup) => (g.produced ? fmt(g.produced) : '—') },
    { key: 'x', header: 'Lost / failed', align: 'right' as const, render: (g: OutputGroup) => (g.lost ? <span className="text-redx-700">{fmt(g.lost)}</span> : '—') },
    { key: 'e', header: 'Entries', align: 'right' as const, render: (g: OutputGroup) => g.entries },
  ];
  const pick = (g: OutputGroup) => setF((x) => ({ ...x, ...g.filter }));
  const groups: Record<Exclude<Tab, 'entries'>, { rows: OutputGroup[]; first: string }> = {
    day: { rows: (data?.byDay ?? []).map((d) => ({ ...d, label: dayName(d.date) })), first: 'Day' },
    operator: { rows: data?.byOperator ?? [], first: 'Operator' },
    zone: { rows: data?.byZone ?? [], first: 'Zone' },
    kind: { rows: data?.byKind ?? [], first: 'Work' },
    batch: { rows: data?.byBatch ?? [], first: 'Batch (sub-culture)' },
    stage: { rows: data?.byStage ?? [], first: 'Stage (sub-culture)' },
  };
  const tabs: { id: Tab; label: string }[] = [
    { id: 'day', label: 'By day' },
    ...(mine ? [] : [{ id: 'operator' as Tab, label: 'By operator' }]),
    { id: 'zone', label: 'By zone' },
    { id: 'kind', label: 'By work' },
    { id: 'batch', label: 'By batch' },
    { id: 'stage', label: 'By stage' },
    { id: 'entries', label: mine ? 'All my entries' : 'All entries' },
  ];

  const csv = () => {
    if (!data) return;
    const g = (title: string, rows: OutputGroup[]) => ({ title, head: [title.replace('By ', ''), 'Target', 'Done', '% of target', 'New bottles', 'Lost / failed', 'Entries'], rows: rows.map((r) => [r.label, r.target, r.handled, r.pct, r.produced, r.lost, r.entries]) });
    downloadCsv(`work-output-${f.from}-to-${f.to}.csv`, `Work output · ${parts.join(' · ') || 'all work'} · ${when}`, [
      g('By day', groups.day.rows), ...(mine ? [] : [g('By operator', data.byOperator)]), g('By zone', data.byZone), g('By work', data.byKind), g('By batch', data.byBatch), g('By stage', data.byStage),
      { title: 'Entries', head: ['Date', 'Operator', 'Zone', 'Work', 'Batch · stage / code', 'How', 'Done', 'New bottles', 'Lost / failed', 'Status'], rows: data.entries.map((e) => [e.workDate, e.operatorName, e.areaName, e.kind, e.label, e.source === 'QR' ? `Scan ${e.qrCode}` : 'Typed in', e.bottlesHandled, e.bottlesProduced, e.bottlesLost, e.status]) },
    ]);
  };

  return (
    <div className={mine ? 'mx-auto flex max-w-3xl flex-col' : undefined}>
      <PageHeader
        help={HELP.output}
        title={mine ? 'My work' : 'Work output'}
        subtitle={mine ? 'Everything you did, scanned or typed in, day by day.' : 'Bottles handled across all work, day by day. Filter by operator, zone, work, batch or stage.'}
        actions={data && <Button variant="secondary" onClick={csv}><Download size={16} /> Excel</Button>}
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((p) => (
            <button key={p.id} onClick={() => set({ from: p.from(), to: p.to() })} className={`focus-ring rounded-full border px-3 py-1.5 text-sm ${period === p.id ? 'border-forest-700 bg-forest-700 text-white' : 'border-[#C3CEC7] bg-white'}`}>{p.label}</button>
          ))}
          <div className="flex items-center gap-1.5 text-sm">
            <Input type="date" aria-label="From" className="w-auto" value={f.from} max={f.to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            <span className="text-ink-muted">to</span>
            <Input type="date" aria-label="To" className="w-auto" value={f.to} min={f.from} max={today()} onChange={(e) => e.target.value && set({ to: e.target.value })} />
          </div>
        </div>
        <div className={`mt-3 grid grid-cols-2 gap-3 ${mine ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}>
          {!mine && (
            <Field label="Operator">
              <Select value={f.operatorId ?? ''} onChange={(e) => set({ operatorId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">All operators</option>
                {o?.operators.map((x) => <option key={x.userId} value={x.userId}>{x.fullName}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Zone">
            <Select value={f.areaId ?? ''} onChange={(e) => set({ areaId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">All zones</option>
              {o?.zones.map((x) => <option key={x.areaId} value={x.areaId}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label="Work">
            <Select value={f.kind ?? ''} onChange={(e) => set({ kind: (e.target.value || null) as WorkKind | null })}>
              <option value="">All work</option>
              {o?.kinds.map((k) => <option key={k} value={k}>{WORK_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Batch">
            <Select value={f.batchId ?? ''} onChange={(e) => set({ batchId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">All batches</option>
              {o?.batches.map((x) => <option key={x.batchId} value={x.batchId}>{x.batchCode}</option>)}
            </Select>
          </Field>
          <Field label="Stage">
            <Select value={f.stageId ?? ''} onChange={(e) => set({ stageId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">All stages</option>
              {o?.stages.map((x) => <option key={x.stageId} value={x.stageId}>{x.code}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-ink-muted">Showing <b className="text-ink">{parts.length ? parts.join(' · ') : mine ? 'all my work' : 'all work'}</b>, {when.charAt(0).toLowerCase() + when.slice(1)}.</p>
          {filtered && <Button variant="ghost" onClick={() => setF({ from: f.from, to: f.to })}><X size={15} /> Clear filters</Button>}
        </div>
      </Card>
      <ErrorText>{error}</ErrorText>

      <div className={`mb-5 grid grid-cols-2 gap-3 ${mine ? 'md:grid-cols-4' : 'md:grid-cols-3 xl:grid-cols-6'}`}>
        <Kpi label="Bottles handled" value={t ? fmt(t.handled) : '—'} note="all work combined" help="Sub-culture, washing, media made and bottles checked, added together." />
        <Kpi label="Target given" value={t ? fmt(t.target) : '—'} note={pct !== null ? `${pct}% done` : 'no work given'} />
        <Kpi label="New bottles" value={t ? fmt(t.produced) : '—'} note="from sub-culture and media" />
        <Kpi label="Lost" value={t ? fmt(t.lost) : '—'} note="in sub-culture" />
        {!mine && <Kpi label="Operators" value={t ? t.operators : '—'} note={t ? `${t.days} working day${t.days === 1 ? '' : 's'}` : undefined} />}
        <Kpi label="Entries" value={t ? t.entries : '—'} note={t?.pending ? `${t.pending} to be checked` : 'all checked'} />
      </div>

      {data && data.byDay.length > 1 && (
        <Card title="Done against target, per day" className="mb-5">
          <BarChart
            label="Bottles handled per day against the target given"
            barName="Done"
            lineName="Target"
            height={200}
            data={[...data.byDay].reverse().map((d) => ({ label: new Date(d.date + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), tip: fmtDate(d.date), bar: d.handled, line: d.target }))}
          />
        </Card>
      )}

      <Card>
        <Tabs<Tab> tabs={tabs} value={tab} onChange={setTab} />
        {tab === 'entries' ? (
          <Table<EntryRow>
            rowKey={(e) => e.entryId}
            rows={data?.entries ?? []}
            empty={data ? 'No work in this period.' : 'Loading…'}
            columns={[
              { key: 'd', header: 'Date', render: (e) => <span className="whitespace-nowrap">{dayName(e.workDate)}</span> },
              ...(mine ? [] : [{ key: 'o', header: 'Operator', render: (e: EntryRow) => e.operatorName }]),
              { key: 'z', header: 'Zone', render: (e) => e.areaName },
              { key: 'w', header: 'Work', render: (e) => (e.kind === 'SUBCULTURE' ? <span className="font-semibold">{e.label}</span> : <span className="flex flex-wrap items-center gap-1.5"><KindTag kind={e.kind} />{e.kind === 'MEDIA' && <span className="text-xs text-ink-muted">{e.label}</span>}</span>) },
              { key: 's', header: 'How', render: (e) => <span className="text-xs text-ink-muted">{e.source === 'QR' ? <>Scan <span className="font-mono">{e.qrCode}</span></> : e.enteredByName ? `Typed in by ${e.enteredByName}` : 'Typed in'}</span> },
              { key: 'h', header: 'Done', align: 'right', render: (e) => <b className="tabular-nums">{fmt(e.bottlesHandled)}</b> },
              { key: 'n', header: 'New', align: 'right', render: (e) => (e.bottlesProduced ? fmt(e.bottlesProduced) : '—') },
              { key: 'x', header: 'Lost / failed', align: 'right', render: (e) => (e.bottlesLost ? <span className="text-redx-700">{e.bottlesLost}</span> : e.kind === 'WASH' && e.contaminated ? <span className="text-xs text-ink-muted">{e.contaminated} contam.</span> : '—') },
              { key: 'st', header: 'Status', render: (e) => <EntryBadge status={e.status} /> },
            ]}
          />
        ) : (
          <Table<OutputGroup>
            rowKey={(g) => g.key}
            rows={groups[tab].rows}
            empty={data ? (tab === 'batch' || tab === 'stage' ? 'No sub-culture work in this selection.' : 'No work in this period.') : 'Loading…'}
            columns={groupCols(groups[tab].first, pick)}
          />
        )}
        {data && data.entries.length >= 400 && tab === 'entries' && <p className="mt-2 text-xs text-ink-muted">Showing the latest 400 entries. Narrow the dates or filters to see the rest; the totals above include everything.</p>}
      </Card>
    </div>
  );
}
