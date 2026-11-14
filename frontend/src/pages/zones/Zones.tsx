import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Thermometer } from 'lucide-react';
import { DayPicker, Progress } from '../../components/daily/bits';
import { Badge, Card, ErrorText, Kpi, PageHeader, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import { basePath, fmt } from '../../lib/paths';
import { AREA_TYPE_LABEL } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';
import type { ZoneSummary } from '../../lib/zonesApi';
import { HELP } from '../../config/pageHelp';

/** All zones on one page: a card for each zone, then one table comparing them. Click a zone to open its own page. */
export default function Zones() {
  const { user } = useAuth();
  const [date, setDate] = useState(today());
  const { data, error } = useLoad(() => (user ? api.zoneSummaries(user, date) : Promise.resolve([])), [user, date]);
  if (!user) return null;
  const zones = data ?? [];
  const base = `${basePath(user)}/zones`;
  const sum = (k: (z: ZoneSummary) => number) => zones.reduce((n, z) => n + k(z), 0);
  const target = sum((z) => z.target);
  const handled = sum((z) => z.handled);

  return (
    <>
      <PageHeader help={HELP.zones}
        title={user.role === 'MANAGER' ? 'All zones' : 'My zones'}
        subtitle="Every zone at a glance. Open a zone to see its operators, trays, benches, losses and alerts."
      />
      <div className="mb-4"><DayPicker value={date} onChange={setDate} max={today()} /></div>
      <ErrorText>{error}</ErrorText>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Zones" value={zones.length} />
        <Kpi label="Operators present" value={`${sum((z) => z.present)} / ${sum((z) => z.operators)}`} />
        <Kpi label="Bottles handled" value={fmt(handled)} note={target ? `of ${fmt(target)} target` : 'no work given'} />
        <Kpi label="Open alerts" value={sum((z) => z.openAlerts)} note={`${sum((z) => z.criticalAlerts)} critical`} />
      </div>

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {!data && <p className="text-sm text-ink-muted">Loading…</p>}
        {zones.map((z) => (
          <Link key={z.areaId} to={`${base}/${z.areaId}`} className="focus-ring group rounded-xl border border-line bg-white p-4 transition hover:border-forest-500 hover:shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-display text-lg font-semibold">{z.name}</div>
                <div className="text-xs text-ink-muted">{AREA_TYPE_LABEL[z.areaType]} · room {z.roomNo}{z.supervisors.length ? ` · ${z.supervisors.join(', ')}` : ' · no supervisor'}</div>
              </div>
              <ChevronRight size={18} className="mt-1 text-ink-muted group-hover:text-forest-700" />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div><dt className="text-xs text-ink-muted">Present</dt><dd className="font-semibold">{z.operators ? `${z.present} / ${z.operators}` : '—'}</dd></div>
              <div><dt className="text-xs text-ink-muted">Trays here</dt><dd className="font-semibold">{z.benches ? fmt(z.trays) : '—'}</dd></div>
              <div><dt className="text-xs text-ink-muted">{z.areaType === 'HARDENING' ? 'Plants' : 'Bottles'}</dt><dd className="font-semibold">{z.trays ? fmt(z.bottles) : '—'}</dd></div>
            </dl>
            {z.target > 0 && (
              <div className="mt-3 text-sm">
                <div className="mb-1 text-xs text-ink-muted">Handled {fmt(z.handled)} of {fmt(z.target)} target</div>
                <Progress pct={z.pct} level="NONE" />
              </div>
            )}
            {z.media && <p className="mt-3 text-sm">{z.media.lots} usable media lots · {fmt(z.media.bottles)} bottles ready{z.media.lowStock ? <span className="text-redx-700"> · {z.media.lowStock} items to reorder</span> : ''}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {z.room && <Badge tone={z.room.status === 'CRITICAL' ? 'red' : z.room.status === 'WARNING' ? 'amber' : 'green'}><Thermometer size={12} className="mr-1 inline" />{z.room.tempC} °C · {z.room.humidityPct}%</Badge>}
              {z.overdueTrays > 0 && <Badge tone="amber">{z.overdueTrays} trays overdue</Badge>}
              {z.openAlerts > 0 ? <Badge tone={z.criticalAlerts ? 'red' : 'amber'}><AlertTriangle size={12} className="mr-1 inline" />{z.openAlerts} open alert{z.openAlerts > 1 ? 's' : ''}</Badge> : <Badge tone="green">No open alerts</Badge>}
            </div>
          </Link>
        ))}
      </div>

      <Card title="Zones side by side">
        <Table<ZoneSummary>
          rowKey={(z) => z.areaId}
          rows={zones}
          empty={data ? 'No zones.' : 'Loading…'}
          columns={[
            { key: 'n', header: 'Zone', render: (z) => <Link to={`${base}/${z.areaId}`} className="font-semibold text-forest-700 hover:underline">{z.name}</Link> },
            { key: 'p', header: 'Present', align: 'right', render: (z) => (z.operators ? `${z.present} / ${z.operators}` : '—') },
            { key: 't', header: 'Target', align: 'right', render: (z) => (z.target ? fmt(z.target) : '—') },
            { key: 'h', header: 'Handled', align: 'right', render: (z) => (z.target || z.handled ? fmt(z.handled) : '—') },
            { key: 'a', header: 'Achieved', render: (z) => <Progress pct={z.pct} level="NONE" compact /> },
            { key: 'tr', header: 'Trays', align: 'right', render: (z) => (z.benches ? fmt(z.trays) : '—') },
            { key: 'f', header: 'Benches full', align: 'right', render: (z) => (z.capacity ? `${Math.round((100 * z.trays) / z.capacity)}%` : '—') },
            { key: 'l', header: 'Lost, 30 days', align: 'right', render: (z) => (z.lost30 ? <span className="text-redx-700">{fmt(z.lost30)}</span> : 0) },
            { key: 'al', header: 'Open alerts', align: 'right', render: (z) => z.openAlerts },
          ]}
        />
      </Card>
    </>
  );
}
