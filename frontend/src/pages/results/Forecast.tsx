import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Settings2 } from 'lucide-react';
import { BarChart } from '../../components/charts/BarChart';
import { StageBadge } from '../../components/production/badges';
import { Badge, Button, Card, ErrorText, Kpi, PageHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { ForecastRow } from '../../lib/resultsApi';
import { fmt, fmtDate } from '../../lib/paths';
import { useLoad } from '../../lib/useLoad';
import { SettingsForm } from '../orders/Orders';

const rupees = (n: number) => (n < 0 ? '−' : '') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Forecast of plants, ready date, cost and profit for every running batch. Manager only. */
export default function Forecast() {
  const { user } = useAuth();
  const { data, error, reload } = useLoad(
    () => (user ? Promise.all([api.forecast(user), api.getSettings(), api.listStages()]) : Promise.reject(new Error('Not logged in'))),
    [user],
  );
  const [openId, setOpenId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fc, settings, stages] = data ?? [null, null, []];
  const rows = fc?.rows ?? [];
  const sum = (k: (r: ForecastRow) => number) => rows.reduce((n, r) => n + k(r), 0);

  // Plants ready per month, next 12 months.
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const perMonth = months.map((m) => ({
    label: new Date(m + '-01T12:00:00').toLocaleDateString('en-IN', { month: 'short' }),
    tip: new Date(m + '-01T12:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    bar: rows.flatMap((r) => r.groups).filter((g) => g.readyDate.startsWith(m)).reduce((n, g) => n + g.expectedPlants, 0),
  }));
  const example = rows.find((r) => r.groups.some((g) => g.roundsLeft > 0)) ?? rows[0];
  const exGroup = example ? [...example.groups].sort((a, b) => b.bottles - a.bottles)[0] : null;

  return (
    <>
      <PageHeader
        title="Forecast and profit"
        subtitle="Worked out from each batch’s own records every time the page opens. Nothing here is typed in by hand."
        actions={<Button variant="secondary" onClick={() => setSettingsOpen(true)} disabled={!settings}><Settings2 size={16} /> Forecast assumptions</Button>}
      />
      <ErrorText>{error}</ErrorText>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Expected plants" value={fmt(sum((r) => r.expectedPlants))} note={`from ${fmt(sum((r) => r.liveBottles))} bottles now`} />
        <Kpi label="Expected revenue" value={rupees(sum((r) => r.expectedRevenue))} />
        <Kpi label="Expected cost" value={rupees(sum((r) => r.expectedCost))} note={fc ? `at ₹${fc.costPerBottle.toFixed(2)} per bottle-round` : undefined} />
        <Kpi label="Expected profit" value={rupees(sum((r) => r.expectedProfit))} />
      </div>

      <Card title="Batch by batch" className="mb-5">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted">
                {['', 'Batch', 'Now', 'Growth', 'Expected plants', 'Ready by', 'Cost so far', 'Cost to come', 'Cost a plant', 'Revenue', 'Profit'].map((h, i) => (
                  <th key={h + i} className={`border-b border-line px-2 py-2 font-semibold ${i >= 4 && i !== 5 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!data && <tr><td colSpan={11} className="py-6 text-center text-ink-muted">Loading…</td></tr>}
              {rows.map((r) => (
                <Fragment key={r.batchId}>
                  <tr className="border-b border-[#EEEAE1]">
                    <td className="px-2 py-2">
                      <button className="focus-ring rounded p-0.5" aria-label={openId === r.batchId ? 'Hide stages' : 'Show stages'} onClick={() => setOpenId(openId === r.batchId ? null : r.batchId)}>
                        {openId === r.batchId ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    </td>
                    <td className="px-2 py-2"><div className="font-semibold">{r.batchCode}</div><div className="text-xs text-ink-muted">{r.cropName}</div></td>
                    <td className="px-2 py-2"><span className="flex items-center gap-1.5"><StageBadge code={r.mainStage} /> {fmt(r.liveBottles)}</span></td>
                    <td className="px-2 py-2">× {r.growth.toFixed(2)} {!r.growthFromHistory && <Badge>crop default</Badge>}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmt(r.expectedPlants)}</td>
                    <td className="px-2 py-2">{r.readyDate ? fmtDate(r.readyDate) : '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{rupees(r.costSoFar)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{rupees(r.futureCost)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.costPerPlant !== null ? `₹${r.costPerPlant.toFixed(2)}` : '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{rupees(r.expectedRevenue)}<div className="text-xs text-ink-muted">at ₹{r.rate}{r.rateFromOrders ? '' : ' (default)'}</div></td>
                    <td className={`px-2 py-2 text-right font-semibold tabular-nums ${r.expectedProfit < 0 ? 'text-redx-700' : 'text-forest-700'}`}>{rupees(r.expectedProfit)}</td>
                  </tr>
                  {openId === r.batchId && r.groups.map((g) => (
                    <tr key={g.stageCode} className="bg-forest-50/60 text-[13px]">
                      <td />
                      <td className="px-2 py-1.5 text-ink-muted">stage group</td>
                      <td className="px-2 py-1.5"><span className="flex items-center gap-1.5"><StageBadge code={g.stageCode} /> {fmt(g.bottles)}</span></td>
                      <td className="px-2 py-1.5">{g.roundsLeft} round{g.roundsLeft === 1 ? '' : 's'} left</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(g.expectedPlants)}</td>
                      <td className="px-2 py-1.5">{fmtDate(g.readyDate)}</td>
                      <td />
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(g.futureHandlings)} bottle-rounds</td>
                      <td colSpan={3} />
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Plants ready per month, next 12 months">
          <BarChart label="Expected plants ready in each of the next 12 months" barName="Expected plants" data={perMonth} />
        </Card>
        <Card title="How it is worked out">
          <ul className="flex flex-col gap-2 text-sm">
            <li><b>Expected plants</b> = bottles now × growth<sup>rounds left</sup> × rooting survival × hardening survival</li>
            <li><b>Growth</b> = new bottles ÷ bottles sub-cultured, from the batch’s own stage history (crop default until it has some)</li>
            <li><b>Rounds left</b> = multiplication stages still ahead, up to {settings?.lastMultiplicationStage ?? 'the last one'}</li>
            <li><b>Ready by</b> = days left in this stage + normal days of every stage ahead (Set-up → Stages)</li>
            <li><b>Cost so far</b> = bottles of the batch handled each month × that month’s cost per bottle-round</li>
            <li><b>Cost to come</b> = bottle-rounds still to do × the latest cost per bottle-round</li>
            <li><b>Revenue</b> = expected plants × average order rate for the crop</li>
          </ul>
          {example && exGroup && settings && (
            <div className="mt-4 rounded-lg bg-black/[0.03] p-3 text-sm">
              <div className="mb-1 font-semibold">Example: {example.batchCode}, {exGroup.stageCode}</div>
              <div className="tabular-nums">
                {fmt(exGroup.bottles)} × {example.growth.toFixed(2)}<sup>{exGroup.roundsLeft}</sup>
                {exGroup.stageCode.startsWith('R') || exGroup.stageCode.startsWith('M') || exGroup.stageCode.startsWith('I') ? ` × ${pct(settings.rootingSurvival)}` : ''} × {pct(settings.hardeningSurvival)} ≈ <b>{fmt(exGroup.expectedPlants)} plants</b>
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-ink-muted">Survival rates and the last multiplication stage are assumptions; set them from your lab’s own records with “Forecast assumptions”.</p>
        </Card>
      </div>

      {settingsOpen && settings && <SettingsForm settings={settings} stages={stages} onClose={() => setSettingsOpen(false)} onSaved={reload} />}
    </>
  );
}
