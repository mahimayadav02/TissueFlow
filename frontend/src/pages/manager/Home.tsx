import { Link } from 'react-router-dom';
import { Thermometer } from 'lucide-react';
import { BarChart, HBars } from '../../components/charts/BarChart';
import { StageBadge } from '../../components/production/badges';
import { Badge, Card, ErrorText, Kpi, PageHeader, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Dashboard } from '../../lib/resultsApi';
import { fmt, fmtDate } from '../../lib/paths';
import { CAUSE_LABEL } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';
import { AlertList } from '../shared/AlertList';

const rupees = (n: number) => (n < 0 ? '−' : '') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
const dayLabel = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** Manager home: the whole lab on one page. */
export default function ManagerHome() {
  const { user } = useAuth();
  const { data, error } = useLoad(() => (user ? Promise.all([api.dashboard(user), api.getLab()]) : Promise.reject(new Error('Not logged in'))), [user]);
  const [d, lab] = data ?? [null, null];
  const lossPct = d && d.loss30.handled ? (100 * d.loss30.lost) / d.loss30.handled : 0;
  const lm = d?.lastMonth;
  const lmName = lm ? new Date(lm.month + '-01T12:00:00').toLocaleDateString('en-IN', { month: 'long' }) : '';

  return (
    <>
      <PageHeader title="Dashboard" subtitle={lab ? `${lab.name} · ${lab.address}` : 'Loading…'} />
      <ErrorText>{error}</ErrorText>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Running batches" value={d ? d.runningBatches : '—'} note={d ? `${fmt(d.liveBottles)} live bottles` : undefined} />
        <Kpi label="Handled today" value={d ? fmt(d.today.handled) : '—'} note={d ? `of ${fmt(d.today.target)} target · ${d.today.present}/${d.today.operators} present` : undefined} />
        <Kpi label="Loss, 30 days" value={d ? `${lossPct.toFixed(1)}%` : '—'} note={d ? `${fmt(d.loss30.lost)} of ${fmt(d.loss30.handled)} bottles` : undefined} />
        <Kpi label="Plants ready in 6 months" value={d ? fmt(d.plantsNext180) : '—'} note={<Link to="/m/forecast" className="underline">forecast</Link>} />
        <Kpi label="Open orders" value={d ? d.openOrders : '—'} note={d ? `${fmt(d.plantsToSend)} plants to send` : undefined} />
        <Kpi label={`Profit, ${lmName || 'last month'}`} value={lm ? rupees(lm.profit) : '—'} note={lm ? `${rupees(lm.revenue)} in − ${rupees(lm.totalCost)} cost` : undefined} />
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-[1fr_340px]">
        <Card title="Bottles handled per day, last 30 days">
          <BarChart
            label="Bottles handled per day against the target given"
            barName="Handled"
            lineName="Target"
            data={(d?.daily ?? []).map((x) => ({ label: dayLabel(x.date), tip: fmtDate(x.date), bar: x.handled, line: x.target }))}
          />
        </Card>
        <RoomCard room={d?.room ?? null} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Batches" className="xl:col-span-2" action={<Link to="/m/batches" className="text-sm font-semibold text-forest-700 underline">All batches</Link>}>
          <Table<Dashboard['batches'][number]>
            rowKey={(b) => b.batchId}
            rows={d?.batches ?? []}
            empty={d ? 'No running batches.' : 'Loading…'}
            columns={[
              { key: 'b', header: 'Batch', render: (b) => <Link className="font-semibold text-forest-700 hover:underline" to={`/m/batches/${b.batchId}`}>{b.batchCode}</Link> },
              { key: 's', header: 'Main stage', render: (b) => <StageBadge code={b.mainStage} /> },
              { key: 'l', header: 'Live bottles', align: 'right', render: (b) => fmt(b.liveBottles) },
              { key: 'p', header: 'Expected plants', align: 'right', render: (b) => fmt(b.expectedPlants) },
              { key: 'r', header: 'Ready by', render: (b) => (b.readyDate ? fmtDate(b.readyDate) : '—') },
            ]}
          />
        </Card>
        <Card title="Losses by cause, 30 days">
          <HBars rows={(d?.loss30.byCause ?? []).map((c) => ({ label: CAUSE_LABEL[c.cause], value: c.bottles }))} unit=" bottles" />
          <p className="mt-3 text-xs text-ink-muted">From loss records. <Link to="/m/contamination" className="underline">See all losses</Link></p>
        </Card>
        <div className="lg:col-span-2 xl:col-span-3"><AlertList /></div>
      </div>
    </>
  );
}

function RoomCard({ room }: { room: Dashboard['room'] }) {
  const tone = (s: 'WARNING' | 'CRITICAL' | null) => (s === 'CRITICAL' ? 'red' : s === 'WARNING' ? 'amber' : 'green');
  const word = (s: 'WARNING' | 'CRITICAL' | null) => (s === 'CRITICAL' ? 'Critical' : s === 'WARNING' ? 'Warning' : 'In range');
  return (
    <Card title={<span className="flex items-center gap-2"><Thermometer size={17} /> Growth room now</span>} action={<Link to="/m/monitoring" className="text-sm font-semibold text-forest-700 underline">Details</Link>}>
      {!room ? (
        <p className="text-sm text-ink-muted">No sensor node set up.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-black/[0.03] p-3"><div className="text-xs text-ink-muted">Temperature</div><div className="font-display text-2xl font-semibold">{room.reading.tempC} °C</div><Badge tone={tone(room.temp)}>{word(room.temp)}</Badge></div>
            <div className="rounded-lg bg-black/[0.03] p-3"><div className="text-xs text-ink-muted">Humidity</div><div className="font-display text-2xl font-semibold">{room.reading.humidityPct}%</div><Badge tone={tone(room.humidity)}>{word(room.humidity)}</Badge></div>
          </div>
          <p className="text-xs text-ink-muted">{room.areaName} · {room.reading.lightLux > 100 ? 'lights on' : 'lights off'} · reading at {new Date(room.reading.recordedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
          <p className="text-xs text-ink-muted">Simulated readings until the sensor node is connected.</p>
        </div>
      )}
    </Card>
  );
}
