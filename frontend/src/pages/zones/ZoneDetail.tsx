import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, ArrowLeft } from 'lucide-react';
import { BarChart, HBars } from '../../components/charts/BarChart';
import { LineChart } from '../../components/charts/LineChart';
import { BoardTable } from '../../components/daily/BoardTable';
import { DayPicker } from '../../components/daily/bits';
import { OverdueBadge, StageBadge } from '../../components/production/badges';
import { Badge, Card, ErrorText, Kpi, PageHeader, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import { basePath, fmt, fmtDate } from '../../lib/paths';
import { AREA_TYPE_LABEL, CAUSE_LABEL } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';
import type { ZoneDetail as Detail } from '../../lib/zonesApi';
import { HELP } from '../../config/pageHelp';

/** One zone's own page. Shows only the parts that make sense for that zone (operators, trays, media, room, losses, alerts). */
export default function ZoneDetail() {
  const { user } = useAuth();
  const { areaId } = useParams();
  const id = Number(areaId);
  const [date, setDate] = useState(today());
  const { data: z, error } = useLoad(() => (user ? api.zoneDetail(id, user, date) : Promise.reject(new Error('Not logged in'))), [user, id, date]);
  if (!user) return null;
  const base = basePath(user);
  const isHardening = z?.areaType === 'HARDENING';
  const unit = isHardening ? 'plants' : 'bottles';

  return (
    <>
      <Link to={`${base}/zones`} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-forest-700 hover:underline"><ArrowLeft size={15} /> All zones</Link>
      <PageHeader help={HELP.zone}
        title={z ? z.name : 'Zone'}
        subtitle={z ? `${AREA_TYPE_LABEL[z.areaType]} · room ${z.roomNo} · ${z.supervisors.length ? `supervisor ${z.supervisors.join(', ')}` : 'no supervisor assigned'}${z.purpose ? ` — ${z.purpose}` : ''}` : 'Loading…'}
      />
      <ErrorText>{error}</ErrorText>
      {z && (
        <>
          {z.operators > 0 && <div className="mb-4"><DayPicker value={date} onChange={setDate} max={today()} /></div>}

          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {z.operators > 0 && <Kpi label="Operators present" value={`${z.present} / ${z.operators}`} note={z.marked < z.operators ? `${z.operators - z.marked} not marked yet` : 'all marked'} />}
            {z.operators > 0 && <Kpi label="Bottles handled" value={fmt(z.handled)} note={z.target ? `of ${fmt(z.target)} target (${z.pct}%)` : 'no work given'} />}
            {z.benches > 0 && <Kpi label={`Trays here`} value={fmt(z.trays)} note={`${fmt(z.bottles)} ${unit} · benches ${z.capacity ? Math.round((100 * z.trays) / z.capacity) : 0}% full`} />}
            {z.media && <Kpi label="Media ready" value={fmt(z.media.bottles)} note={`${z.media.lots} usable lots`} />}
            {z.room && <Kpi label="Room now" value={`${z.room.tempC} °C`} note={`${z.room.humidityPct}% humidity · ${z.room.status === 'CRITICAL' ? 'critical' : z.room.status === 'WARNING' ? 'warning' : 'in range'}`} />}
            <Kpi label="Lost, 30 days" value={fmt(z.lost30)} note={`${unit} in trays kept here`} />
            <Kpi label="Open alerts" value={z.openAlerts} note={z.criticalAlerts ? `${z.criticalAlerts} critical` : 'none critical'} />
          </div>

          <div className="flex flex-col gap-5">
            {z.operators > 0 && (
              <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
                <Card title={`Operators · ${fmtDate(date)}`} action={user.role !== 'OPERATOR' && <Link to="/s/assign" className="text-sm font-semibold text-forest-700 underline">Give work</Link>}>
                  <BoardTable rows={z.board} loading={false} showZone={false} />
                  {z.board.every((r) => !r.target) && (
                    <p className="mt-3 text-xs text-ink-muted">No bottle targets here: work given in the app is batch-and-stage work (sub-culturing). Attendance still counts for this zone.</p>
                  )}
                </Card>
                <Card title="Handled vs target, last 14 days">
                  <BarChart
                    label={`Bottles handled per day in ${z.name} against the target`}
                    barName="Handled"
                    lineName="Target"
                    height={200}
                    data={z.daily.map((d) => ({ label: new Date(d.date + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), tip: fmtDate(d.date), bar: d.handled, line: d.target }))}
                  />
                </Card>
              </div>
            )}

            {z.room && z.roomSeries.length > 0 && (
              <Card title="Room temperature, last 24 hours" action={<Link to={`${base}/monitoring`} className="text-sm font-semibold text-forest-700 underline">Room monitoring</Link>}>
                <LineChart
                  label={`Temperature in ${z.name} over the last 24 hours`}
                  unit="°C"
                  height={190}
                  formatTime={(t) => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  series={[{ name: 'Temperature', points: z.roomSeries.map((r) => ({ t: new Date(r.recordedAt).getTime(), y: r.tempC })) }]}
                />
                <p className="mt-2 text-xs text-ink-muted">Simulated readings until the sensor node is connected.</p>
              </Card>
            )}

            {z.benches > 0 && (
              <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
                <Card title={`What is kept here (${fmt(z.trays)} trays)`} action={<Link to={`${base}/trays`} className="text-sm font-semibold text-forest-700 underline">All trays</Link>}>
                  <Table<Detail['byStage'][number]>
                    rowKey={(r) => `${r.batchId}-${r.stage}`}
                    rows={z.byStage}
                    empty="No trays in this zone right now."
                    columns={[
                      { key: 'b', header: 'Batch', render: (r) => <Link to={`${base}/batches/${r.batchId}`} className="font-semibold text-forest-700 hover:underline">{r.batchCode}</Link> },
                      { key: 's', header: 'Stage', render: (r) => <StageBadge code={r.stage} /> },
                      { key: 't', header: 'Trays', align: 'right', render: (r) => r.trays },
                      { key: 'n', header: isHardening ? 'Plants' : 'Bottles', align: 'right', render: (r) => fmt(r.bottles) },
                      { key: 'd', header: 'Oldest', render: (r) => <OverdueBadge level={r.overdue} days={r.oldestDays} /> },
                    ]}
                  />
                </Card>
                <Card title="Benches">
                  <ul className="flex flex-col gap-2.5">
                    {z.benchLoad.map((b) => {
                      const pct = b.capacity ? Math.min(100, Math.round((100 * b.trays) / b.capacity)) : 0;
                      return (
                        <li key={b.benchId} className="text-sm">
                          <div className="mb-1 flex justify-between"><span className="font-semibold">{b.code}</span><span className="tabular-nums text-ink-muted">{b.trays} / {b.capacity} trays</span></div>
                          <div className="h-2 rounded-full bg-black/[0.06]"><div className="h-2 rounded-full bg-forest-500" style={{ width: `${pct}%` }} /></div>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </div>
            )}

            {z.areaType === 'MEDIA' && (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card title="Usable media lots" action={<Link to={`${base === '/m' ? '/m/stock' : '/s/media'}`} className="text-sm font-semibold text-forest-700 underline">Stock and media</Link>}>
                  <Table<Detail['mediaLots'][number]>
                    rowKey={(l) => l.lotCode}
                    rows={z.mediaLots}
                    empty="No usable media lots. Make a new lot on the Stock and media page."
                    columns={[
                      { key: 'c', header: 'Lot', render: (l) => <span className="font-mono text-[13px] font-semibold">{l.lotCode}</span> },
                      { key: 'r', header: 'Recipe', render: (l) => l.recipe },
                      { key: 'b', header: 'Bottles left', align: 'right', render: (l) => fmt(l.bottlesLeft) },
                      { key: 'e', header: 'Use by', render: (l) => fmtDate(l.expiresOn) },
                    ]}
                  />
                </Card>
                <Card title="Stock to reorder">
                  <Table<Detail['lowStock'][number]>
                    rowKey={(s) => s.name}
                    rows={z.lowStock}
                    empty="Nothing below its reorder level."
                    columns={[
                      { key: 'n', header: 'Item', render: (s) => s.name },
                      { key: 's', header: 'In stock', align: 'right', render: (s) => <span className="font-semibold text-redx-700">{s.stockQty} {s.unit}</span> },
                      { key: 'r', header: 'Reorder at', align: 'right', render: (s) => `${s.reorderLevel} ${s.unit}` },
                    ]}
                  />
                </Card>
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Losses by cause, last 30 days">
                <HBars rows={z.lossByCause.map((c) => ({ label: CAUSE_LABEL[c.cause], value: c.bottles }))} unit={` ${unit}`} />
              </Card>
              <Card title="Open alerts in this zone" action={<Link to={`${base}/alerts`} className="text-sm font-semibold text-forest-700 underline">All alerts</Link>}>
                {z.alerts.length === 0 ? (
                  <p className="text-sm text-ink-muted">No open alerts.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {z.alerts.map((a) => (
                      <li key={a.alertId} className="flex items-start gap-2 text-sm">
                        <span className={a.severity === 'CRITICAL' ? 'text-redx-700' : 'text-amberx-700'} aria-hidden>{a.severity === 'CRITICAL' ? <AlertOctagon size={17} /> : <AlertTriangle size={17} />}</span>
                        <div>
                          <div><Badge tone={a.severity === 'CRITICAL' ? 'red' : 'amber'}>{a.severity === 'CRITICAL' ? 'Critical' : 'Warning'}</Badge> <span className="font-semibold">{a.label}</span></div>
                          <div>{a.message}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
