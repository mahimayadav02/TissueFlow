import { useState, type FormEvent } from 'react';
import { Plus, RefreshCw, Settings2, Truck, X } from 'lucide-react';
import { StageBadge } from '../../components/production/badges';
import { Badge, Button, Card, ErrorText, Field, FormActions, Input, Kpi, Modal, PageHeader, Select, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { addDays, today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import type { OrderCheck, OrderInput, OrderRow } from '../../lib/opsApi';
import { fmt, fmtDate } from '../../lib/paths';
import type { Crop, Decision, Settings, Stage } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';

const rupees = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const DECISION: Record<Decision, { label: string; tone: 'green' | 'amber' | 'red' }> = {
  YES: { label: 'Yes', tone: 'green' },
  PARTLY: { label: 'Partly', tone: 'amber' },
  NO: { label: 'No', tone: 'red' },
};

/** Customer orders: "can we deliver by this date?", then plants sent against the order. Manager only. */
export default function Orders() {
  const { user } = useAuth();
  const { data, error, reload } = useLoad(
    () => (user ? Promise.all([api.listOrders(user), api.listCrops(), api.getSettings(), api.listStages()]) : Promise.reject(new Error('Not logged in'))),
    [user],
  );
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<OrderRow | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [orders, crops, settings, stages] = data ?? [[], [], null, []];

  const live = orders.filter((o) => o.status === 'OPEN');
  const outstanding = live.reduce((n, o) => n + Math.max(0, o.plantsPromised - o.plantsSent), 0);
  const expected = live.reduce((n, o) => n + Math.max(0, o.plantsPromised - o.plantsSent) * o.ratePerPlant, 0);
  const month = today().slice(0, 7);
  const sentThisMonth = orders.flatMap((o) => o.deliveries).filter((d) => d.sentOn.startsWith(month)).reduce((n, d) => n + d.plantsSent, 0);

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Before saying yes to a customer, check the order: the forecast of running batches says how many plants will be ready by that date."
        actions={
          <>
            <Button variant="secondary" onClick={() => setSettingsOpen(true)} disabled={!settings}><Settings2 size={16} /> Forecast assumptions</Button>
            <Button onClick={() => setAdding(true)} disabled={!crops.length}><Plus size={16} /> New order</Button>
          </>
        }
      />
      <ErrorText>{error}</ErrorText>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Open orders" value={live.length} />
        <Kpi label="Plants still to send" value={fmt(outstanding)} note="promised, not yet sent" />
        <Kpi label="Revenue to come" value={rupees(expected)} note="promised × rate" />
        <Kpi label="Plants sent this month" value={fmt(sentThisMonth)} />
      </div>

      <Card>
        <Table<OrderRow>
          rowKey={(o) => o.orderId}
          rows={orders}
          empty={data ? 'No orders yet.' : 'Loading…'}
          columns={[
            { key: 'c', header: 'Order', render: (o) => <button className="font-semibold text-forest-700 hover:underline" onClick={() => setOpen(o)}>{o.orderCode}</button> },
            { key: 'n', header: 'Customer', render: (o) => <div><div>{o.customerName}</div><div className="text-xs text-ink-muted">{o.cropName}</div></div> },
            { key: 'p', header: 'Plants ordered', align: 'right', render: (o) => fmt(o.plantsOrdered) },
            { key: 'pr', header: 'Promised', align: 'right', render: (o) => fmt(o.plantsPromised) },
            { key: 's', header: 'Sent', align: 'right', render: (o) => fmt(o.plantsSent) },
            { key: 'r', header: 'Rate', align: 'right', render: (o) => `₹${o.ratePerPlant}` },
            { key: 'd', header: 'Needed by', render: (o) => fmtDate(o.requiredBy) },
            { key: 'de', header: 'Can we?', render: (o) => <Badge tone={DECISION[o.decision].tone}>{DECISION[o.decision].label}</Badge> },
            { key: 'st', header: 'Status', render: (o) => (o.status === 'OPEN' ? <Badge tone="blue">Open</Badge> : o.status === 'DELIVERED' ? <Badge tone="green">Delivered</Badge> : <Badge>Cancelled</Badge>) },
          ]}
        />
      </Card>

      {adding && <NewOrder crops={crops} onClose={() => setAdding(false)} onSaved={reload} />}
      {open && <OrderDetail order={open} onClose={() => setOpen(null)} onChanged={async () => { await reload(); setOpen(null); }} />}
      {settingsOpen && settings && <SettingsForm settings={settings} stages={stages} onClose={() => setSettingsOpen(false)} onSaved={reload} />}
    </>
  );
}

/** The "can we deliver?" result: numbers, decision and the batches that would supply the plants. */
function CheckResult({ c, rate }: { c: OrderCheck; rate: number }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">Can we deliver?</div>
        <Badge tone={DECISION[c.decision].tone} className="px-3 py-1 text-sm">{DECISION[c.decision].label}{c.decision === 'PARTLY' ? `: ${fmt(c.plantsPromised)} plants` : ''}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div><dt className="text-xs text-ink-muted">Ready by that date</dt><dd className="font-semibold">{fmt(c.readyByDate)}</dd></div>
        <div><dt className="text-xs text-ink-muted">Promised to others</dt><dd className="font-semibold">{fmt(c.promisedToOthers)}</dd></div>
        <div><dt className="text-xs text-ink-muted">Free for this order</dt><dd className="font-semibold">{fmt(c.available)}</dd></div>
        <div><dt className="text-xs text-ink-muted">Revenue</dt><dd className="font-semibold">{rupees(c.expectedRevenue)}</dd><dd className="text-xs text-ink-muted">{fmt(c.plantsPromised)} × ₹{rate}</dd></div>
        <div><dt className="text-xs text-ink-muted">Expected cost</dt><dd className="font-semibold">{c.expectedCost === null ? '—' : rupees(c.expectedCost)}</dd>{c.costPerPlant !== null && <dd className="text-xs text-ink-muted">₹{c.costPerPlant.toFixed(2)} a plant</dd>}</div>
        <div><dt className="text-xs text-ink-muted">Expected profit</dt><dd className={`font-semibold ${c.expectedProfit !== null && c.expectedProfit < 0 ? 'text-redx-700' : 'text-forest-700'}`}>{c.expectedProfit === null ? '—' : rupees(c.expectedProfit)}</dd></div>
      </dl>
      {c.groups.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-ink-muted">Plants ready by then come from</div>
          <ul className="flex flex-col gap-1 text-sm">
            {c.groups.map((g) => (
              <li key={`${g.batchId}-${g.stageCode}`} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{g.batchCode}</span> <StageBadge code={g.stageCode} />
                <span className="text-ink-muted">{fmt(g.bottles)} now → about {fmt(g.expectedPlants)} plants by {fmtDate(g.readyDate)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">No running batch of this crop is forecast to be ready by that date.</p>
      )}
    </div>
  );
}

function NewOrder({ crops, onClose, onSaved }: { crops: Crop[]; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [v, setV] = useState<{ customerName: string; phone: string; cropId: number; plantsOrdered: number | ''; ratePerPlant: number | ''; requiredBy: string }>(
    { customerName: '', phone: '', cropId: crops[0]?.cropId ?? 0, plantsOrdered: '', ratePerPlant: '', requiredBy: addDays(today(), 90) },
  );
  const [result, setResult] = useState<OrderCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = (): OrderInput => ({ ...v, plantsOrdered: v.plantsOrdered === '' ? 0 : v.plantsOrdered, ratePerPlant: v.ratePerPlant === '' ? 0 : v.ratePerPlant });
  const change = (patch: Partial<typeof v>) => {
    setV({ ...v, ...patch });
    setResult(null);
  };
  const run = async (fn: () => Promise<void>) => {
    if (!user) return;
    setBusy(true);
    setError('');
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.'); } finally { setBusy(false); }
  };
  const doCheck = (e: FormEvent) => {
    e.preventDefault();
    run(async () => setResult(await api.checkOrder(input(), user!)));
  };
  const doSave = () => run(async () => {
    await api.createOrder(input(), user!);
    onSaved();
    onClose();
  });

  return (
    <Modal title="New order" onClose={onClose} wide>
      <form onSubmit={doCheck} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer"><Input value={v.customerName} onChange={(e) => change({ customerName: e.target.value })} placeholder="Name or farm" autoFocus /></Field>
          <Field label="Phone" hint="Optional"><Input value={v.phone} onChange={(e) => change({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} inputMode="numeric" /></Field>
          <Field label="Crop">
            <Select value={v.cropId} onChange={(e) => change({ cropId: Number(e.target.value) })}>
              {crops.map((c) => <option key={c.cropId} value={c.cropId}>{c.name} {c.variety}</option>)}
            </Select>
          </Field>
          <Field label="Needed by"><Input type="date" min={addDays(today(), 1)} value={v.requiredBy} onChange={(e) => change({ requiredBy: e.target.value })} /></Field>
          <Field label="Plants"><Input type="number" min={1} value={v.plantsOrdered} onChange={(e) => change({ plantsOrdered: e.target.value === '' ? '' : Math.round(Number(e.target.value)) })} /></Field>
          <Field label="Rate per plant (₹)"><Input type="number" min={0} step="0.5" value={v.ratePerPlant} onChange={(e) => change({ ratePerPlant: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
        </div>
        {result && <CheckResult c={result} rate={input().ratePerPlant} />}
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          {result ? (
            <Button type="button" onClick={doSave} disabled={busy}>{busy ? 'Saving…' : `Save order (${DECISION[result.decision].label})`}</Button>
          ) : (
            <Button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Check order'}</Button>
          )}
        </FormActions>
      </form>
    </Modal>
  );
}

function OrderDetail({ order, onClose, onChanged }: { order: OrderRow; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  const [recheck, setRecheck] = useState<OrderCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isOpen = order.status === 'OPEN';
  const run = async (fn: () => Promise<void>) => {
    if (!user) return;
    setBusy(true);
    setError('');
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.'); } finally { setBusy(false); }
  };

  if (sending) return <SendForm order={order} onClose={() => setSending(false)} onSaved={onChanged} />;

  return (
    <Modal title={`${order.orderCode} · ${order.customerName}`} onClose={onClose} wide>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-ink-muted">Crop</dt><dd className="font-semibold">{order.cropName}</dd></div>
        <div><dt className="text-xs text-ink-muted">Needed by</dt><dd className="font-semibold">{fmtDate(order.requiredBy)}</dd></div>
        <div><dt className="text-xs text-ink-muted">Ordered · promised</dt><dd className="font-semibold">{fmt(order.plantsOrdered)} · {fmt(order.plantsPromised)}</dd></div>
        <div><dt className="text-xs text-ink-muted">Rate</dt><dd className="font-semibold">₹{order.ratePerPlant} a plant</dd></div>
        <div><dt className="text-xs text-ink-muted">Decision</dt><dd><Badge tone={DECISION[order.decision].tone}>{DECISION[order.decision].label}</Badge></dd></div>
        <div><dt className="text-xs text-ink-muted">Sent so far</dt><dd className="font-semibold">{fmt(order.plantsSent)}</dd></div>
        <div><dt className="text-xs text-ink-muted">Revenue so far</dt><dd className="font-semibold">{rupees(order.revenueSoFar)}</dd></div>
        <div><dt className="text-xs text-ink-muted">Phone</dt><dd className="font-semibold">{order.phone || '—'}</dd></div>
      </dl>

      <div className="mt-4">
        <div className="mb-1 text-sm font-semibold">Plants sent</div>
        {order.deliveries.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing sent yet.</p>
        ) : (
          <ul className="text-sm">
            {order.deliveries.map((d) => <li key={d.deliveryId}>{fmtDate(d.sentOn)}: <b>{fmt(d.plantsSent)}</b> plants from {d.batchCode}</li>)}
          </ul>
        )}
      </div>

      {recheck && <div className="mt-4"><p className="mb-2 text-sm text-forest-700">Checked again with today’s forecast and saved.</p><CheckResult c={recheck} rate={order.ratePerPlant} /></div>}
      <ErrorText>{error}</ErrorText>
      {isOpen && (
        <FormActions>
          <Button variant="ghost" className="text-redx-700" disabled={busy} onClick={() => run(async () => { await api.cancelOrder(order.orderId, user!); onChanged(); })}><X size={16} /> Cancel order</Button>
          <Button variant="secondary" disabled={busy || order.requiredBy <= today()} onClick={() => run(async () => setRecheck(await api.recheckOrder(order.orderId, user!)))}><RefreshCw size={16} /> Check again</Button>
          <Button disabled={busy || order.decision === 'NO'} onClick={() => setSending(true)}><Truck size={16} /> Record plants sent</Button>
        </FormActions>
      )}
      {recheck && <FormActions><Button onClick={onChanged}>Done</Button></FormActions>}
    </Modal>
  );
}

function SendForm({ order, onClose, onSaved }: { order: OrderRow; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const { data: stock } = useLoad(() => api.hardenedStock(order.cropId), [order.cropId]);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [plants, setPlants] = useState<number | ''>(Math.max(0, order.plantsPromised - order.plantsSent) || '');
  const [sentOn, setSentOn] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = batchId ?? stock?.[0]?.batchId ?? 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      await api.recordDelivery(order.orderId, chosen, plants === '' ? 0 : plants, sentOn, user);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Plants sent for ${order.orderCode}`} onClose={onClose}>
      {!stock ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : stock.length === 0 ? (
        <>
          <p className="text-sm text-ink-muted">No batch of {order.cropName} has plants in hardening right now.</p>
          <FormActions><Button onClick={onClose}>Close</Button></FormActions>
        </>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="From batch" hint="Plants are taken from the batch's hardening trays, secondary hardening first.">
            <Select value={chosen} onChange={(e) => setBatchId(Number(e.target.value))}>
              {stock.map((s) => <option key={s.batchId} value={s.batchId}>{s.batchCode} · {fmt(s.plants)} plants in {s.stages}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Plants sent" hint={`${fmt(order.plantsOrdered - order.plantsSent)} left on the order`}><Input type="number" min={1} value={plants} onChange={(e) => setPlants(e.target.value === '' ? '' : Math.round(Number(e.target.value)))} autoFocus /></Field>
            <Field label="Sent on"><Input type="date" max={today()} min={addDays(today(), -7)} value={sentOn} onChange={(e) => setSentOn(e.target.value)} /></Field>
          </div>
          <ErrorText>{error}</ErrorText>
          <FormActions>
            <Button type="button" variant="ghost" onClick={onClose}>Back</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </FormActions>
        </form>
      )}
    </Modal>
  );
}

export function SettingsForm({ settings, stages, onClose, onSaved }: { settings: Settings; stages: Stage[]; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [root, setRoot] = useState(Math.round(settings.rootingSurvival * 100));
  const [hard, setHard] = useState(Math.round(settings.hardeningSurvival * 100));
  const [lastM, setLastM] = useState(settings.lastMultiplicationStage);
  const [rate, setRate] = useState(settings.defaultRate ?? 15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      await api.saveSettings({ rootingSurvival: root / 100, hardeningSurvival: hard / 100, lastMultiplicationStage: lastM, defaultRate: rate }, user);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Forecast assumptions" onClose={onClose}>
      <p className="mb-4 text-sm text-ink-muted">Expected plants = bottles now × growth ^ rounds left × rooting survival × hardening survival. Growth comes from each batch’s own history. Set these from your lab’s records.</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rooting survival (%)"><Input type="number" min={1} max={100} value={root} onChange={(e) => setRoot(Number(e.target.value))} /></Field>
          <Field label="Hardening survival (%)"><Input type="number" min={1} max={100} value={hard} onChange={(e) => setHard(Number(e.target.value))} /></Field>
        </div>
        <Field label="Last multiplication stage" hint="Batches are forecast to multiply up to this stage, then go to rooting.">
          <Select value={lastM} onChange={(e) => setLastM(e.target.value)}>
            {stages.filter((s) => s.phase === 'MULTIPLICATION').map((s) => <option key={s.stageId}>{s.code}</option>)}
          </Select>
        </Field>
        <Field label="Sale rate when a crop has no orders (₹ a plant)" hint="Expected revenue uses the average rate of the crop's orders; this is used only when there are none.">
          <Input type="number" min={0} step="0.5" value={rate} onChange={(e) => setRate(Number(e.target.value))} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
