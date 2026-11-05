import { useState, type ReactNode } from 'react';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { DayPicker } from '../../components/daily/bits';
import { Button, ErrorText, Select, Tabs } from '../../components/ui';
import { api } from '../../lib/api';
import { addDays, today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import { downloadCsv, type CsvTable } from '../../lib/csv';
import { fmt, fmtDate } from '../../lib/paths';
import type { DayReport, MonthReport } from '../../lib/resultsApi';
import { ATT_LABEL, CAUSE_LABEL } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';

type Kind = 'day' | 'month';
const rupees = (n: number) => (n < 0 ? '−' : '') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
const monthName = (m: string) => new Date(m + '-01T12:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;
const lastMonths = () => {
  const [y, m] = today().slice(0, 7).split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(y, m - 1 - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
};

/** Daily production report and monthly lab report: print / save as PDF, or download for Excel. Supervisors see their own zones. */
export default function Report() {
  const { user } = useAuth();
  const months = lastMonths();
  const [kind, setKind] = useState<Kind>('day');
  const [month, setMonth] = useState(months[1]);
  const [date, setDate] = useState(addDays(today(), -1));
  const { data, error } = useLoad<DayReport | MonthReport>(
    () => (user ? (kind === 'day' ? api.dayReport(date, user) : api.report(month, user)) : Promise.reject(new Error('Not logged in'))),
    [user, kind, date, month],
  );
  const day = kind === 'day' ? (data as DayReport | null) : null;
  const mon = kind === 'month' ? (data as MonthReport | null) : null;
  const ready = kind === 'day' ? !!day && 'operators' in day && 'byBatch' in day : !!mon && 'zones' in mon;

  const excel = () => {
    if (kind === 'day' && day) downloadCsv(`daily-report-${day.date}.csv`, `Daily production report ${day.date} · ${day.labName} · ${day.scope}`, dayTables(day));
    if (kind === 'month' && mon) downloadCsv(`monthly-report-${mon.month}.csv`, `Monthly lab report ${monthName(mon.month)} · ${mon.labName} · ${mon.scope}`, monthTables(mon));
  };

  return (
    <>
      <div className="no-print mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold sm:text-[28px]">Reports</h1>
            <p className="mt-1 text-sm text-ink-muted">Print gives paper or a PDF (choose “Save as PDF” in the print window). Excel downloads every table as one file.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={excel} disabled={!ready}><FileSpreadsheet size={16} /> Excel</Button>
            <Button onClick={() => window.print()} disabled={!ready}><Printer size={16} /> Print</Button>
          </div>
        </div>
        <div className="mt-4"><Tabs<Kind> value={kind} onChange={setKind} tabs={[{ id: 'day', label: 'Daily production' }, { id: 'month', label: 'Monthly' }]} /></div>
        {kind === 'day' ? (
          <DayPicker value={date} onChange={setDate} max={today()} />
        ) : (
          <Select value={month} onChange={(e) => setMonth(e.target.value)} className="w-auto" aria-label="Month">
            {months.map((m) => <option key={m} value={m}>{monthName(m)}{m === months[0] ? ' (so far)' : ''}</option>)}
          </Select>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      {!ready ? <p className="text-sm text-ink-muted">Preparing report…</p> : kind === 'day' ? <DayView r={day!} /> : <MonthView r={mon!} />}
    </>
  );
}

// ---------------- daily ----------------
function dayTables(r: DayReport): CsvTable[] {
  return [
    { title: '1. Operators: attendance, target and work done', head: ['Operator', 'Zone', 'Attendance', 'Work given', 'Target', 'Handled', 'Achieved %', 'New bottles', 'Lost', 'Verified', 'To check', 'Sent back'], rows: r.operators.map((o) => [o.name, o.areaName, o.attendance ? ATT_LABEL[o.attendance] : 'Not marked', o.work, o.target, o.handled, o.pct, o.produced, o.lost, o.verified, o.pending, o.sentBack]) },
    { title: '2. Work by batch and stage', head: ['Batch', 'Stage', 'Handled', 'New bottles', 'Lost'], rows: r.byBatch.map((b) => [b.batchCode, b.stage, b.handled, b.produced, b.lost]) },
    { title: '3. Losses recorded', head: ['Tray', 'Batch', 'Stage', 'Cause', 'Bottles', 'Note'], rows: r.losses.map((l) => [l.qrCode, l.batchCode, l.stage, CAUSE_LABEL[l.cause], l.bottles, l.note]) },
    { title: '4. Stock used', head: ['Item', 'Quantity', 'Unit', 'Note'], rows: r.stockUsed.map((s) => [s.name, s.qty, s.unit, s.note]) },
    { title: '5. Alerts raised', head: ['Time', 'Alert', 'Details'], rows: r.alerts.map((a) => [a.time, a.label, a.message]) },
  ];
}

function DayView({ r }: { r: DayReport }) {
  const target = r.operators.reduce((n, o) => n + o.target, 0);
  const handled = r.operators.reduce((n, o) => n + o.handled, 0);
  const produced = r.operators.reduce((n, o) => n + o.produced, 0);
  const lost = r.operators.reduce((n, o) => n + o.lost, 0);
  const present = r.operators.filter((o) => o.attendance === 'P' || o.attendance === 'HD').length;
  return (
    <Paper title={`Daily production report · ${fmtDate(r.date)}`} sub={`${r.labName} · ${r.scope} · prepared by ${r.generatedBy} on ${new Date(r.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fig label="Present" value={`${present} / ${r.operators.length}`} />
        <Fig label="Bottles handled" value={fmt(handled)} note={target ? `${Math.round((100 * handled) / target)}% of ${fmt(target)} target` : 'no work given'} />
        <Fig label="New bottles" value={fmt(produced)} />
        <Fig label="Lost" value={fmt(lost)} note={handled ? `${((100 * lost) / handled).toFixed(1)}% of handled` : undefined} />
      </div>
      {dayTables(r).map((t, i) => (
        <Section key={t.title} title={t.title}>
          <T head={t.head} rows={t.rows} empty={['No operators in these zones.', 'No work entered.', 'No losses recorded.', 'No stock used (or not your zone).', 'No alerts.'][i]} />
        </Section>
      ))}
      <Footer at={r.generatedAt} />
    </Paper>
  );
}

// ---------------- monthly ----------------
function monthTables(r: MonthReport): CsvTable[] {
  const t: CsvTable[] = [
    { title: '1a. Zone-wise target vs achieved', head: ['Zone', 'Operators', 'Target', 'Handled', 'Achieved %', 'Lost'], rows: r.zones.map((z) => [z.areaName, z.operators, z.target, z.handled, z.pct, z.lost]) },
    { title: '1b. Operators', head: ['Operator', 'Zone', 'Present', 'Half day', 'Absent', 'Target', 'Handled', 'Achieved %', 'Lost'], rows: r.operators.map((o) => [o.name, o.areaName, o.P, o.HD, o.A, o.target, o.handled, o.pct, o.lost]) },
    { title: '2. Batch-wise stage stock and forecast ready date (as on today)', head: ['Batch', 'Bottles by stage', 'Live bottles', 'Expected plants', 'Ready by'], rows: r.batches.map((b) => [b.batchCode, b.byStage, b.liveBottles, b.expectedPlants, b.readyDate]) },
    { title: '3a. Contamination by cause', head: ['Cause', 'Bottles lost'], rows: r.lossByCause.map((c) => [CAUSE_LABEL[c.cause], c.bottles]) },
    { title: '3b. Contamination by stage', head: ['Stage', 'Bottles lost'], rows: r.lossByStage.map((c) => [c.stage, c.bottles]) },
    { title: '4a. Stock used', head: ['Item', 'Quantity', 'Unit'], rows: r.stockUsed.map((s) => [s.name, s.qty, s.unit]) },
    { title: '4b. Stock below reorder level', head: ['Item', 'In stock', 'Reorder at', 'Unit'], rows: r.stockLow.map((s) => [s.name, s.stockQty, s.reorderLevel, s.unit]) },
  ];
  if (r.money && r.orders) t.push({ title: '5. Orders, dispatches, costs and profit (₹)', head: ['Orders taken', 'Plants ordered', 'Plants sent', 'Revenue', 'Total cost', 'Profit'], rows: [[r.orders.created, r.orders.plantsOrdered, r.orders.plantsSent, Math.round(r.money.revenue), Math.round(r.money.totalCost), Math.round(r.money.profit)]] });
  if (r.room) t.push({ title: `${r.money ? 6 : 5}a. Room conditions`, head: ['', 'Lowest', 'Highest', 'Average'], rows: [['Temperature (°C)', r.room.tempMin, r.room.tempMax, r.room.tempAvg], ['Humidity (%)', r.room.humMin, r.room.humMax, r.room.humAvg]] });
  t.push({ title: `${r.money ? 6 : 5}b. Alerts raised`, head: ['Alert', 'Times raised'], rows: r.alertsByCode.map((a) => [a.label, a.count]) });
  return t;
}

function MonthView({ r }: { r: MonthReport }) {
  const target = r.zones.reduce((n, z) => n + z.target, 0);
  const handled = r.zones.reduce((n, z) => n + z.handled, 0);
  const lost = r.zones.reduce((n, z) => n + z.lost, 0);
  const n6 = r.money ? 6 : 5;
  return (
    <Paper title={`Monthly lab report · ${monthName(r.month)}`} sub={`${r.labName} · ${r.scope} · prepared by ${r.generatedBy} on ${new Date(r.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fig label="Bottles handled" value={fmt(handled)} note={target ? `${Math.round((100 * handled) / target)}% of ${fmt(target)} target` : undefined} />
        <Fig label="Loss" value={handled ? `${((100 * lost) / handled).toFixed(1)}%` : '—'} note={plural(lost, 'bottle', 'bottles')} />
        {r.orders ? <Fig label="Plants sent" value={fmt(r.orders.plantsSent)} note={plural(r.orders.deliveries, 'dispatch', 'dispatches')} /> : <Fig label="Operators" value={String(r.operators.length)} />}
        {r.money ? <Fig label="Cost per bottle-round" value={r.money.costPerBottle != null ? `₹${r.money.costPerBottle.toFixed(2)}` : '—'} /> : <Fig label="Alerts raised" value={String(r.alertsByCode.reduce((n, a) => n + a.count, 0))} />}
      </div>

      <Section title="1. Zone-wise target vs achieved">
        <T head={['Zone', 'Operators', 'Target', 'Handled', 'Achieved', 'Lost']} rows={r.zones.map((z) => [z.areaName, z.operators, fmt(z.target), fmt(z.handled), z.pct === null ? '—' : `${z.pct}%`, z.lost])} />
        <T head={['Operator', 'Zone', 'Present', 'Half day', 'Absent', 'Target', 'Handled', 'Achieved', 'Lost']} rows={r.operators.map((o) => [o.name, o.areaName, o.P, o.HD, o.A, fmt(o.target), fmt(o.handled), o.pct === null ? '—' : `${o.pct}%`, o.lost])} />
        <p className="text-xs text-ink-muted">Attendance as marked by supervisors; target and handled from the work given and the entries made.</p>
      </Section>
      <Section title="2. Batch-wise stage stock and forecast ready date (as on today)">
        <T head={['Batch', 'Bottles by stage', 'Live bottles', 'Expected plants', 'Ready by']} rows={r.batches.map((b) => [b.batchCode, b.byStage, fmt(b.liveBottles), fmt(b.expectedPlants), b.readyDate ? fmtDate(b.readyDate) : '—'])} />
      </Section>
      <Section title="3. Contamination by cause and stage">
        <div className="grid gap-4 sm:grid-cols-2">
          <T head={['Cause', 'Bottles lost']} rows={r.lossByCause.map((c) => [CAUSE_LABEL[c.cause], c.bottles])} empty="No losses recorded." />
          <T head={['Stage', 'Bottles lost']} rows={r.lossByStage.map((c) => [c.stage, c.bottles])} empty="No losses recorded." />
        </div>
        <p className="text-xs text-ink-muted">Losses by operator are in the “Lost” column of section 1.</p>
      </Section>
      <Section title="4. Stock used, and stock below reorder level">
        <div className="grid gap-4 sm:grid-cols-2">
          <T head={['Item', 'Used']} rows={r.stockUsed.map((s) => [s.name, `${s.qty} ${s.unit}`])} empty="No stock used (or not your zone)." />
          <T head={['Item', 'In stock', 'Reorder at']} rows={r.stockLow.map((s) => [s.name, `${s.stockQty} ${s.unit}`, `${s.reorderLevel} ${s.unit}`])} empty="Nothing below reorder level." />
        </div>
      </Section>
      {r.money && r.orders && (
        <Section title="5. Orders, dispatches, costs and profit">
          <T head={['Orders taken', 'Plants ordered', 'Plants sent', 'Revenue', 'Total cost', 'Profit']} rows={[[r.orders.created, fmt(r.orders.plantsOrdered), fmt(r.orders.plantsSent), rupees(r.money.revenue), rupees(r.money.totalCost), rupees(r.money.profit)]]} />
          <p className="text-xs text-ink-muted">Profit = revenue from plants sent − the month’s costs entered on the Monthly costs page.</p>
        </Section>
      )}
      <Section title={`${n6}. Room conditions and alerts`}>
        {r.room ? (
          <T head={['', 'Lowest', 'Highest', 'Average']} rows={[['Temperature (°C)', r.room.tempMin, r.room.tempMax, r.room.tempAvg], ['Humidity (%)', r.room.humMin, r.room.humMax, r.room.humAvg]]} />
        ) : <p className="text-sm text-ink-muted">No sensor node in these zones.</p>}
        <T head={['Alert', 'Times raised']} rows={r.alertsByCode.map((a) => [a.label, a.count])} empty="No alerts this month." />
        {r.room && <p className="text-xs text-ink-muted">{fmt(r.room.readings)} sensor readings (simulated until the node is connected).</p>}
      </Section>
      <Footer at={r.generatedAt} />
    </Paper>
  );
}

// ---------------- shared pieces ----------------
function Paper({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-line bg-white">
      <div className="bg-forest px-4 py-4 text-white sm:px-6">
        <div className="font-display text-xl font-semibold">{title}</div>
        <div className="text-sm text-[#CFE6DA]">{sub}</div>
      </div>
      <div className="flex flex-col gap-6 px-4 py-4 sm:px-6 sm:pb-6">{children}</div>
    </article>
  );
}

function Footer({ at }: { at: string }) {
  return (
    <div className="mt-2 flex flex-wrap justify-between gap-2 border-t border-line pt-3 text-xs text-ink-muted">
      <span>Figures worked out from the records on {new Date(at).toLocaleDateString('en-IN')}.</span>
      <span>Checked by ____________________</span>
    </div>
  );
}

function Fig({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-[#B9D8C6] bg-forest-50 px-3 py-2">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="font-display text-xl font-semibold text-[#14532D]">{value}</div>
      {note && <div className="text-xs text-ink-muted">{note}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="print-break flex flex-col gap-3">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Numbers (and ₹ amounts, %, dashes) line up on the right; words stay on the left. */
const isNumeric = (c: string | number | null) => typeof c === 'number' || (typeof c === 'string' && /^[−\-₹]?[\d,.]+%?$|^—$/.test(c.trim()));

function T({ head, rows, empty = 'Nothing to show.' }: { head: string[]; rows: (string | number | null)[][]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-ink-muted">{empty}</p>;
  const numCol = head.map((_, j) => rows.every((r) => r[j] === null || r[j] === '' || isNumeric(r[j])));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>{head.map((h, j) => <th key={h + j} className={`border-b border-line px-2 py-1.5 text-xs font-semibold text-ink-muted ${numCol[j] ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-[#EEEAE1] last:border-0">
              {r.map((c, j) => <td key={j} className={`px-2 py-1.5 ${numCol[j] ? 'text-right tabular-nums' : ''}`}>{c ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
