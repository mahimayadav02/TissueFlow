import { useState } from 'react';
import { AlertOctagon, AlertTriangle, Check } from 'lucide-react';
import { Badge, Button, Card, ErrorText, PageHeader, Tabs } from '../../components/ui';
import { api } from '../../lib/api';
import { addDays, today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import type { AlertRow } from '../../lib/resultsApi';
import { useLoad } from '../../lib/useLoad';

type Tab = 'open' | 'seen';

/** What to do about each kind of alert. */
const WHAT_TO_DO: Record<string, string> = {
  TRAY_OVERDUE: 'Sub-culture these trays soon, or move them to the next stage.',
  HARDENING_CHECK: 'Count the surviving plants and record any losses.',
  LOW_OUTPUT: 'Talk to the operator; check if the target or the work given was right.',
  HIGH_LOSS: 'Check hoods, media lots and handling in this zone (see Contamination).',
  LOW_STOCK: 'Order more before it runs out.',
  ROOM_TEMP_HIGH: 'Check the air conditioner and door of the room.',
  ROOM_TEMP_LOW: 'Check the air conditioner setting.',
  HUMIDITY_HIGH: 'Check the dehumidifier and for water on the floor.',
  DEVICE_OFFLINE: 'Check power and Wi-Fi of the sensor node.',
};

/** Alerts raised from the alert limits. Manager sees all; supervisor own zones; operator own zone. */
export default function Alerts() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('open');
  const [severity, setSeverity] = useState<'' | 'CRITICAL' | 'WARNING'>('');
  const { data, error, reload } = useLoad(() => (user ? api.listAlerts(user) : Promise.resolve([])), [user]);
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [ackError, setAckError] = useState('');
  if (!user) return null;
  const canAck = user.role !== 'OPERATOR';
  const all = data ?? [];
  const from = addDays(today(), -30);
  const open = all.filter((a) => !a.ackAt);
  const seen = all.filter((a) => a.ackAt && a.createdAt.slice(0, 10) >= from);
  const rows = (tab === 'open' ? open : seen).filter((a) => !severity || a.severity === severity);

  const ack = async (ids: number[]) => {
    setBusy(true);
    setAckError('');
    try {
      await api.acknowledgeAlerts(ids, user);
      setPicked([]);
      await reload();
    } catch (e) {
      setAckError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: number) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Raised automatically when a limit in Set-up → Alert limits is crossed. Acknowledge an alert once someone is dealing with it."
        actions={canAck && tab === 'open' && open.length > 0 && <Button onClick={() => ack(picked)} disabled={busy || !picked.length}><Check size={16} /> Acknowledge {picked.length || ''}</Button>}
      />
      <Tabs<Tab> value={tab} onChange={(t) => { setTab(t); setPicked([]); }} tabs={[{ id: 'open', label: `Open (${open.length})` }, { id: 'seen', label: 'Acknowledged, last 30 days' }]} />
      <div className="mb-4 flex flex-wrap gap-2">
        {([['', 'All'], ['CRITICAL', 'Critical'], ['WARNING', 'Warning']] as const).map(([v, l]) => (
          <button key={l} onClick={() => setSeverity(v)} className={`focus-ring rounded-full border px-3 py-1.5 text-sm ${severity === v ? 'border-forest-700 bg-forest-700 text-white' : 'border-[#C6BFB0] bg-white'}`}>{l}</button>
        ))}
      </div>
      <ErrorText>{error || ackError}</ErrorText>

      <Card>
        {!data ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">{tab === 'open' ? 'No open alerts.' : 'Nothing acknowledged in the last 30 days.'}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((a: AlertRow) => (
              <li key={a.alertId} className={`flex items-start gap-3 rounded-lg border p-3 ${a.severity === 'CRITICAL' && !a.ackAt ? 'border-redx-700/40 bg-redx-100/40' : 'border-[#EEEAE1]'}`}>
                {canAck && !a.ackAt && <input type="checkbox" className="mt-1" aria-label={`Select alert: ${a.message}`} checked={picked.includes(a.alertId)} onChange={() => toggle(a.alertId)} />}
                <span className={a.severity === 'CRITICAL' ? 'text-redx-700' : 'text-amberx-700'} aria-hidden>
                  {a.severity === 'CRITICAL' ? <AlertOctagon size={20} /> : <AlertTriangle size={20} />}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={a.severity === 'CRITICAL' ? 'red' : 'amber'}>{a.severity === 'CRITICAL' ? 'Critical' : 'Warning'}</Badge>
                    <span className="font-semibold">{a.label}</span>
                    <span className="text-xs text-ink-muted">{a.areaName} · {new Date(a.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </div>
                  <div className="mt-1">{a.message}</div>
                  {WHAT_TO_DO[a.code] && !a.ackAt && <div className="mt-1 text-xs text-ink-muted">What to do: {WHAT_TO_DO[a.code]}</div>}
                  {a.ackAt && <div className="mt-1 text-xs text-ink-muted">Acknowledged by {a.ackByName} · {new Date(a.ackAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>}
                </div>
                {canAck && !a.ackAt && <Button variant="ghost" className="min-h-[36px] px-2.5" onClick={() => ack([a.alertId])} disabled={busy}><Check size={15} /> OK</Button>}
              </li>
            ))}
          </ul>
        )}
        {canAck && tab === 'open' && rows.length > 1 && (
          <label className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" checked={rows.every((r) => picked.includes(r.alertId))} onChange={() => setPicked(rows.every((r) => picked.includes(r.alertId)) ? [] : rows.map((r) => r.alertId))} /> Select all
          </label>
        )}
      </Card>
    </>
  );
}
