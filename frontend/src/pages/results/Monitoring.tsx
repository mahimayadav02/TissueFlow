import { useEffect, useState, type ReactNode } from 'react';
import { Cpu, Droplets, Sun, Thermometer } from 'lucide-react';
import { LineChart, type Limit } from '../../components/charts/LineChart';
import { Badge, Card, ErrorText, PageHeader, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { AlertRow } from '../../lib/resultsApi';
import type { SensorReading, Severity } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';

const RANGES = [
  { hours: 6, label: '6 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 168, label: '7 days' },
];
const tone = (s: Severity | null) => (s === 'CRITICAL' ? 'red' : s === 'WARNING' ? 'amber' : 'green');
const word = (s: Severity | null) => (s === 'CRITICAL' ? 'Critical' : s === 'WARNING' ? 'Warning' : 'In range');
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/** Live conditions from the IoT node in the growth room, with alert limits. Refreshes every minute. */
export default function Monitoring() {
  const { user } = useAuth();
  const [hours, setHours] = useState(24);
  const { data, error, reload } = useLoad(() => (user ? api.room(hours, user) : Promise.resolve(null)), [user, hours]);
  useEffect(() => {
    const id = window.setInterval(reload, 60_000);
    return () => window.clearInterval(id);
  }, [reload]);

  const fmtT = (t: number) => {
    const d = new Date(t);
    return hours > 48 ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };
  const lim = (pair: [number, number | null] | null, word2: string, unit: string): Limit[] =>
    !pair ? [] : [{ value: pair[0], label: `${word2} ${pair[0]}${unit}`, tone: 'warning' as const }, ...(pair[1] !== null ? [{ value: pair[1], label: `Critical ${pair[1]}${unit}`, tone: 'critical' as const }] : [])];

  if (data === null && !error) {
    return (
      <>
        <PageHeader title="Room monitoring" />
        <Card><p className="text-sm text-ink-muted">Loading… (or no sensor node in your zones)</p></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Room monitoring" subtitle="Temperature, humidity and light from the sensor node. Limits come from Set-up → Alert limits." />
      <ErrorText>{error}</ErrorText>
      {data && (
        <>
          <p className="mb-4 rounded-lg bg-amberx-100 px-3 py-2 text-sm text-amberx-700">
            These readings are simulated until the ESP32 node is connected. The node will send a reading every {data.device.intervalMin} minutes; nothing else on this page changes.
          </p>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile icon={<Thermometer size={18} />} label="Temperature" value={`${data.latest.tempC} °C`} badge={<Badge tone={tone(data.status.temp)}>{word(data.status.temp)}</Badge>} />
            <Tile icon={<Droplets size={18} />} label="Humidity" value={`${data.latest.humidityPct}%`} badge={<Badge tone={tone(data.status.humidity)}>{word(data.status.humidity)}</Badge>} />
            <Tile icon={<Sun size={18} />} label="Light" value={`${data.latest.lightLux.toLocaleString('en-IN')} lux`} badge={<Badge>{data.latest.lightLux > 100 ? 'Lights on' : 'Lights off'}</Badge>} />
            <Tile icon={<Cpu size={18} />} label={data.device.name} value={data.areaName} badge={<Badge tone="green">Online · {time(data.latest.recordedAt)}</Badge>} small />
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {RANGES.map((r) => (
              <button key={r.hours} onClick={() => setHours(r.hours)} className={`focus-ring rounded-full border px-3 py-1.5 text-sm ${hours === r.hours ? 'border-forest-700 bg-forest-700 text-white' : 'border-[#C6BFB0] bg-white'}`}>{r.label}</button>
            ))}
          </div>

          <div className="mb-5 grid gap-5 xl:grid-cols-2">
            <Card title={`Temperature · lowest ${data.stats.tempMin} °C, highest ${data.stats.tempMax} °C, average ${data.stats.tempAvg} °C`}>
              <LineChart
                label="Growth room temperature over time with warning and critical limits"
                unit="°C"
                formatTime={fmtT}
                series={[{ name: 'Temperature', points: data.series.map((r) => ({ t: new Date(r.recordedAt).getTime(), y: r.tempC })) }]}
                limits={[...lim(data.limits.tempHigh, 'High', ' °C'), ...lim(data.limits.tempLow, 'Low', ' °C')]}
              />
            </Card>
            <Card title={`Humidity · lowest ${data.stats.humMin}%, highest ${data.stats.humMax}%, average ${data.stats.humAvg}%`}>
              <LineChart
                label="Growth room humidity over time with warning and critical limits"
                unit="%"
                formatTime={fmtT}
                series={[{ name: 'Humidity', points: data.series.map((r) => ({ t: new Date(r.recordedAt).getTime(), y: r.humidityPct })) }]}
                limits={lim(data.limits.humidityHigh, 'High', '%')}
              />
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Latest readings">
              <Table<SensorReading>
                rowKey={(r) => r.recordedAt}
                rows={[...data.series].reverse().slice(0, 12)}
                columns={[
                  { key: 't', header: 'Time', render: (r) => (hours > 48 ? new Date(r.recordedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : time(r.recordedAt)) },
                  { key: 'c', header: 'Temp °C', align: 'right', render: (r) => r.tempC },
                  { key: 'h', header: 'Humidity %', align: 'right', render: (r) => r.humidityPct },
                  { key: 'l', header: 'Light lux', align: 'right', render: (r) => r.lightLux.toLocaleString('en-IN') },
                ]}
              />
            </Card>
            <Card title="Room alerts">
              <Table<AlertRow>
                rowKey={(a) => a.alertId}
                rows={data.alerts}
                empty="No room alerts."
                columns={[
                  { key: 's', header: '', render: (a) => <Badge tone={a.severity === 'CRITICAL' ? 'red' : 'amber'}>{a.severity === 'CRITICAL' ? 'Critical' : 'Warning'}</Badge> },
                  { key: 'm', header: 'What happened', render: (a) => <div>{a.message}<div className="text-xs text-ink-muted">{new Date(a.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div></div> },
                  { key: 'a', header: 'Seen', render: (a) => (a.ackAt ? <span className="text-xs text-ink-muted">by {a.ackByName}</span> : <Badge tone="amber">Open</Badge>) },
                ]}
              />
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function Tile({ icon, label, value, badge, small = false }: { icon: ReactNode; label: string; value: string; badge: ReactNode; small?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center gap-2 text-xs text-ink-muted">{icon}<span className="truncate">{label}</span></div>
      <div className={`mt-1 font-semibold ${small ? 'text-base' : 'font-display text-2xl'}`}>{value}</div>
      <div className="mt-1">{badge}</div>
    </div>
  );
}
