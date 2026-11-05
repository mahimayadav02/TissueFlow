import { useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Kpi, PageHeader, Select, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import type { MonthSummary } from '../../lib/forecast';
import type { BatchCostRow } from '../../lib/opsApi';
import { fmt } from '../../lib/paths';
import { HEADING_LABEL, type CostHeading } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';

const HEADINGS = Object.keys(HEADING_LABEL) as CostHeading[];
const rupees = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const monthName = (m: string) => new Date(m + '-01T12:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
/** The current month and the 11 before it. */
const lastMonths = () => {
  const [y, m] = today().slice(0, 7).split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(y, m - 1 - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
};

/** Manager enters the month's cost totals. The page works out cost per bottle-round, each batch's cost so far, and the month's profit. */
export default function MonthlyCosts() {
  const { user } = useAuth();
  const months = lastMonths();
  const [month, setMonth] = useState(months[1]);
  const { data, error, reload } = useLoad(
    () => (user ? Promise.all([api.getMonth(month, user), api.monthHistory(user, 6), api.batchCosts(user)]) : Promise.reject(new Error('Not logged in'))),
    [user, month],
  );
  const [amounts, setAmounts] = useState<Partial<Record<CostHeading, number | ''>>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [summary, history, batches] = data ?? [null, [], []];

  useEffect(() => {
    if (!summary) return;
    const a: Partial<Record<CostHeading, number | ''>> = {};
    for (const h of HEADINGS) a[h] = summary.byHeading[h] ?? '';
    setAmounts(a);
    setSaved(false);
    setSaveError('');
  }, [summary]);

  const total = HEADINGS.reduce((n, h) => n + (Number(amounts[h]) || 0), 0);
  const dirty = summary ? HEADINGS.some((h) => (Number(amounts[h]) || 0) !== (summary.byHeading[h] ?? 0)) : false;
  const submit = async () => {
    if (!user) return;
    setBusy(true);
    setSaveError('');
    try {
      const out: Partial<Record<CostHeading, number>> = {};
      for (const h of HEADINGS) out[h] = Number(amounts[h]) || 0;
      await api.saveMonthCosts(month, out, user);
      await reload();
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Monthly costs" subtitle="Enter what the lab spent in a month, heading by heading. No bills or salaries needed, just the totals." />
      <div className="mb-4 flex items-center gap-2">
        <Select value={month} onChange={(e) => setMonth(e.target.value)} className="w-auto" aria-label="Month">
          {months.map((m) => <option key={m} value={m}>{monthName(m)}{m === months[0] ? ' (this month)' : ''}</option>)}
        </Select>
      </div>
      <ErrorText>{error}</ErrorText>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total cost" value={summary ? rupees(summary.totalCost) : '—'} />
        <Kpi label="Bottles handled" value={summary ? fmt(summary.bottlesHandled) : '—'} note="every sub-culture that month" />
        <Kpi
          label="Cost per bottle-round"
          value={summary?.costPerBottle != null ? `₹${summary.costPerBottle.toFixed(2)}` : '—'}
          note={summary && summary.costPerBottle == null ? (summary.totalCost ? 'no bottles handled' : `not entered; forecast uses ₹${summary.rateUsed.toFixed(2)}`) : 'total cost ÷ bottles handled'}
        />
        <Kpi label="Profit" value={summary ? rupees(summary.profit) : '—'} note={summary ? `${fmt(summary.plantsSent)} plants sent = ${rupees(summary.revenue)}` : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <Card title={`Costs for ${monthName(month)}`}>
          <div className="flex flex-col gap-3">
            {HEADINGS.map((h) => (
              <Field key={h} label={`${HEADING_LABEL[h]} (₹)`}>
                <Input type="number" min={0} step="100" value={amounts[h] ?? ''} onChange={(e) => { setAmounts({ ...amounts, [h]: e.target.value === '' ? '' : Number(e.target.value) }); setSaved(false); }} />
              </Field>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-sm">Total <b>{rupees(total)}</b></span>
            <div className="flex items-center gap-3">
              {saved && !dirty && <span className="text-sm font-semibold text-forest-700">Saved.</span>}
              <Button onClick={submit} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
          <ErrorText>{saveError}</ErrorText>
        </Card>

        <div className="flex flex-col gap-5">
          <Card title="Last months">
            <Table<MonthSummary>
              rowKey={(m) => m.month}
              rows={history}
              empty={data ? 'No months yet.' : 'Loading…'}
              columns={[
                { key: 'm', header: 'Month', render: (m) => <button className="font-semibold text-forest-700 hover:underline" onClick={() => setMonth(m.month)}>{monthName(m.month)}</button> },
                { key: 'c', header: 'Cost', align: 'right', render: (m) => (m.totalCost ? rupees(m.totalCost) : '—') },
                { key: 'b', header: 'Bottles handled', align: 'right', render: (m) => fmt(m.bottlesHandled) },
                { key: 'r', header: 'Per bottle-round', align: 'right', render: (m) => (m.costPerBottle != null ? `₹${m.costPerBottle.toFixed(2)}` : '—') },
                { key: 'v', header: 'Revenue', align: 'right', render: (m) => (m.revenue ? rupees(m.revenue) : '—') },
                { key: 'p', header: 'Profit', align: 'right', render: (m) => <span className={m.profit < 0 ? 'text-redx-700' : ''}>{rupees(m.profit)}</span> },
              ]}
            />
          </Card>
          <Card title="Cost so far, batch by batch">
            <Table<BatchCostRow>
              rowKey={(b) => b.batchId}
              rows={batches}
              empty={data ? 'No batches.' : 'Loading…'}
              columns={[
                { key: 'b', header: 'Batch', render: (b) => <span className="font-semibold">{b.batchCode}</span> },
                { key: 's', header: 'Status', render: (b) => <span className="text-ink-muted">{b.status === 'RUNNING' ? 'Running' : 'Closed'}</span> },
                { key: 'c', header: 'Cost so far', align: 'right', render: (b) => rupees(b.costSoFar) },
              ]}
            />
            <p className="mt-3 text-xs text-ink-muted">Cost so far = bottles of the batch sub-cultured in each month × that month’s cost per bottle-round. A month with no costs entered uses the nearest month that has them. Expected cost and profit per batch come on the Forecast page.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
