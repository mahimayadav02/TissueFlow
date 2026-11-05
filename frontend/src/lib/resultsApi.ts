// FAKE API, Phase 6: dashboard, forecast and profit, room monitoring, alerts, monthly report, audit log.
import { evaluateAlerts } from './alertEngine';
import { addDays, copy, need, today, wait } from './apiUtil';
import { forecastAll, monthSummary, rateFor, type BatchForecast, type MonthSummary } from './forecast';
import { latestReading, readings } from './iot';
import { visibleAreas } from './productionApi';
import { db, save } from './store';
import type { Alert, AttStatus, AuditEntry, LossCause, SensorDevice, SensorReading, Severity, User } from './types';

const nameOf = (id: number | null | undefined) => db.users.find((u) => u.userId === id)?.fullName ?? '—';
const areaName = (id: number | null) => db.areas.find((a) => a.areaId === id)?.name ?? 'Whole lab';
const managerOnly = (user: User) => need(user.role === 'MANAGER', 'Only the manager can see this.');
const staffOnly = (user: User) => need(user.role !== 'OPERATOR', 'Only a supervisor or manager can see this.');
const live = (e: { status: string }) => e.status !== 'REJECTED';
const monthOf = (iso: string) => iso.slice(0, 7);

/** Alerts a user may see: manager all; supervisor own zones; operator own zone, minus alerts about other operators. */
function canSeeAlert(user: User, a: Alert) {
  if (user.role === 'MANAGER') return true;
  if (user.role === 'SUPERVISOR') return a.areaId !== null && user.zoneIds.includes(a.areaId);
  return a.areaId !== null && a.areaId === user.homeAreaId && (!a.userId || a.userId === user.userId);
}

// ---------- shapes returned to pages ----------
export interface AlertRow extends Alert {
  areaName: string;
  ackByName: string | null;
  label: string;
}

export interface ForecastRow extends BatchForecast {
  cropName: string;
  mainStage: string;
  rate: number;
  rateFromOrders: boolean;
  expectedRevenue: number;
  expectedProfit: number;
}

export interface Dashboard {
  runningBatches: number;
  liveBottles: number;
  today: { target: number; handled: number; present: number; operators: number };
  loss30: { handled: number; lost: number; byCause: { cause: LossCause; bottles: number }[] };
  daily: { date: string; handled: number; target: number }[];
  /** Plants forecast to be ready in the next 6 months. */
  plantsNext180: number;
  openOrders: number;
  plantsToSend: number;
  lastMonth: MonthSummary;
  batches: { batchId: number; batchCode: string; mainStage: string; liveBottles: number; expectedPlants: number; readyDate: string | null }[];
  room: { reading: SensorReading; deviceName: string; areaName: string; temp: Severity | null; humidity: Severity | null } | null;
}

export interface RoomData {
  device: SensorDevice;
  areaName: string;
  latest: SensorReading;
  status: { temp: Severity | null; humidity: Severity | null };
  limits: { tempHigh: [number, number | null] | null; tempLow: [number, number | null] | null; humidityHigh: [number, number | null] | null };
  series: SensorReading[];
  stats: { tempMin: number; tempMax: number; tempAvg: number; humMin: number; humMax: number; humAvg: number };
  alerts: AlertRow[];
}

export interface MonthReport {
  month: string;
  labName: string;
  scope: string;
  generatedBy: string;
  generatedAt: string;
  zones: { areaName: string; operators: number; target: number; handled: number; pct: number | null; lost: number }[];
  operators: { name: string; areaName: string; P: number; HD: number; A: number; target: number; handled: number; pct: number | null; lost: number }[];
  batches: { batchCode: string; byStage: string; liveBottles: number; expectedPlants: number; readyDate: string | null }[];
  lossByCause: { cause: LossCause; bottles: number }[];
  lossByStage: { stage: string; bottles: number }[];
  stockUsed: { name: string; unit: string; qty: number }[];
  stockLow: { name: string; unit: string; stockQty: number; reorderLevel: number }[];
  money: MonthSummary | null;
  orders: { created: number; plantsOrdered: number; deliveries: number; plantsSent: number } | null;
  room: { tempMin: number; tempMax: number; tempAvg: number; humMin: number; humMax: number; humAvg: number; readings: number } | null;
  alertsByCode: { label: string; count: number }[];
}

export interface DayReport {
  date: string;
  labName: string;
  scope: string;
  generatedBy: string;
  generatedAt: string;
  operators: { name: string; areaName: string; attendance: AttStatus | null; work: string; target: number; handled: number; produced: number; lost: number; pct: number | null; pending: number; verified: number; sentBack: number }[];
  byBatch: { batchCode: string; stage: string; handled: number; produced: number; lost: number }[];
  losses: { qrCode: string; batchCode: string; stage: string; cause: LossCause; bottles: number; note: string }[];
  stockUsed: { name: string; unit: string; qty: number; note: string }[];
  alerts: { time: string; label: string; message: string }[];
}

export interface AuditRow extends AuditEntry {
  userName: string;
}

const ALERT_LABEL = () => Object.fromEntries(db.alertRules.map((r) => [r.code, r.label])) as Record<string, string>;

function alertRow(a: Alert): AlertRow {
  return { ...copy(a), areaName: areaName(a.areaId), ackByName: a.ackBy ? nameOf(a.ackBy) : null, label: ALERT_LABEL()[a.code] ?? a.code };
}

function limits() {
  const pair = (code: string): [number, number | null] | null => {
    const r = db.alertRules.find((x) => x.code === code);
    return r ? [r.warnValue, r.criticalValue] : null;
  };
  return { tempHigh: pair('ROOM_TEMP_HIGH'), tempLow: pair('ROOM_TEMP_LOW'), humidityHigh: pair('HUMIDITY_HIGH') };
}

function roomStatus(r: SensorReading) {
  const l = limits();
  const hi = (v: number, p: [number, number | null] | null): Severity | null => (!p ? null : p[1] !== null && v > p[1] ? 'CRITICAL' : v > p[0] ? 'WARNING' : null);
  const lo = (v: number, p: [number, number | null] | null): Severity | null => (!p ? null : p[1] !== null && v < p[1] ? 'CRITICAL' : v < p[0] ? 'WARNING' : null);
  const t = hi(r.tempC, l.tempHigh) ?? lo(r.tempC, l.tempLow);
  return { temp: t, humidity: hi(r.humidityPct, l.humidityHigh) };
}

function stats(rs: SensorReading[]) {
  const avg = (xs: number[]) => Math.round((xs.reduce((n, x) => n + x, 0) / Math.max(1, xs.length)) * 10) / 10;
  const t = rs.map((r) => r.tempC);
  const h = rs.map((r) => r.humidityPct);
  return { tempMin: Math.min(...t), tempMax: Math.max(...t), tempAvg: avg(t), humMin: Math.min(...h), humMax: Math.max(...h), humAvg: avg(h) };
}

/** Sale rate per plant for a crop: weighted average of its orders, else the default rate in the forecast assumptions. */
function rateOf(cropId: number): { rate: number; fromOrders: boolean } {
  const os = db.orders.filter((o) => o.cropId === cropId && o.status !== 'CANCELLED');
  const plants = os.reduce((n, o) => n + o.plantsOrdered, 0);
  if (plants > 0) return { rate: Math.round((os.reduce((n, o) => n + o.plantsOrdered * o.ratePerPlant, 0) / plants) * 100) / 100, fromOrders: true };
  return { rate: db.settings.defaultRate ?? 15, fromOrders: false };
}

function forecastRows(): ForecastRow[] {
  return forecastAll().map((f) => {
    const crop = db.crops.find((c) => c.cropId === f.cropId);
    const { rate, fromOrders } = rateOf(f.cropId);
    const main = [...f.groups].sort((a, b) => b.bottles - a.bottles)[0];
    const expectedRevenue = f.expectedPlants * rate;
    return {
      ...f, cropName: crop ? `${crop.name} ${crop.variety}` : '—', mainStage: main?.stageCode ?? '—',
      rate, rateFromOrders: fromOrders, expectedRevenue, expectedProfit: expectedRevenue - f.expectedCost,
    };
  });
}

export const resultsApi = {
  // ---------- alerts ----------
  async listAlerts(user: User): Promise<AlertRow[]> {
    await wait();
    evaluateAlerts();
    return db.alerts.filter((a) => canSeeAlert(user, a)).map(alertRow).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async acknowledgeAlerts(ids: number[], user: User): Promise<void> {
    await wait();
    staffOnly(user);
    need(ids.length > 0, 'Choose at least one alert.');
    for (const id of ids) {
      const a = db.alerts.find((x) => x.alertId === id);
      need(a && canSeeAlert(user, a), 'Alert not found.');
      if (a!.ackAt) continue;
      a!.ackAt = new Date().toISOString();
      a!.ackBy = user.userId;
    }
    save();
  },

  // ---------- dashboard ----------
  async dashboard(user: User): Promise<Dashboard> {
    await wait();
    managerOnly(user);
    evaluateAlerts();
    const fc = forecastRows();
    const t = today();
    const todays = db.entries.filter((e) => e.workDate === t && live(e));
    const ops = db.users.filter((u) => u.role === 'OPERATOR' && u.status === 'ACTIVE');
    const from30 = addDays(t, -30);
    const e30 = db.entries.filter((e) => e.workDate >= from30 && live(e));
    const causeTotals = new Map<LossCause, number>();
    for (const c of db.contaminations) if (c.foundOn >= from30) causeTotals.set(c.cause, (causeTotals.get(c.cause) ?? 0) + c.bottlesLost);
    const daily: Dashboard['daily'] = [];
    for (let i = 29; i >= 0; i--) {
      const d = addDays(t, -i);
      const target = db.assignments.filter((a) => a.workDate === d).reduce((n, a) => n + a.targetBottles, 0);
      const handled = e30.filter((e) => e.workDate === d).reduce((n, e) => n + e.bottlesHandled, 0);
      if (target || handled) daily.push({ date: d, handled, target });
    }
    const [y, m] = t.slice(0, 7).split('-').map(Number);
    const prev = new Date(y, m - 2, 1);
    const lastMonth = monthSummary(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`);
    const open = db.orders.filter((o) => o.status === 'OPEN');
    const dev = db.devices[0];
    const r = dev ? latestReading(dev.intervalMin) : null;
    const in180 = addDays(t, 180);
    return {
      runningBatches: fc.length,
      liveBottles: fc.reduce((n, f) => n + f.liveBottles, 0),
      today: {
        target: db.assignments.filter((a) => a.workDate === t).reduce((n, a) => n + a.targetBottles, 0),
        handled: todays.reduce((n, e) => n + e.bottlesHandled, 0),
        present: db.attendance.filter((a) => a.workDate === t && a.status !== 'A').length,
        operators: ops.length,
      },
      loss30: {
        handled: e30.reduce((n, e) => n + e.bottlesHandled, 0),
        lost: e30.reduce((n, e) => n + e.bottlesLost, 0),
        byCause: [...causeTotals.entries()].map(([cause, bottles]) => ({ cause, bottles })).sort((a, b) => b.bottles - a.bottles),
      },
      daily,
      plantsNext180: fc.flatMap((f) => f.groups).filter((g) => g.readyDate <= in180).reduce((n, g) => n + g.expectedPlants, 0),
      openOrders: open.length,
      plantsToSend: open.reduce((n, o) => n + Math.max(0, o.plantsPromised - db.deliveries.filter((d) => d.orderId === o.orderId).reduce((k, d) => k + d.plantsSent, 0)), 0),
      lastMonth,
      batches: fc.map((f) => ({ batchId: f.batchId, batchCode: f.batchCode, mainStage: f.mainStage, liveBottles: f.liveBottles, expectedPlants: f.expectedPlants, readyDate: f.readyDate })),
      room: dev && r ? { reading: r, deviceName: dev.name, areaName: areaName(dev.areaId), ...roomStatus(r) } : null,
    };
  },

  // ---------- forecast and profit ----------
  async forecast(user: User): Promise<{ rows: ForecastRow[]; costPerBottle: number }> {
    await wait();
    managerOnly(user);
    return { rows: forecastRows(), costPerBottle: rateFor(monthOf(today())) };
  },

  // ---------- room monitoring ----------
  async room(hours: number, user: User): Promise<RoomData | null> {
    await wait(150);
    staffOnly(user);
    evaluateAlerts();
    const dev = db.devices.find((d) => user.role === 'MANAGER' || user.zoneIds.includes(d.areaId));
    if (!dev) return null;
    const now = Date.now();
    // Every reading for a day; for a week, one every 30 minutes keeps the chart light.
    const step = hours > 48 ? 30 : dev.intervalMin;
    const series = readings(now - hours * 3_600_000, now, step);
    const latest = latestReading(dev.intervalMin);
    return {
      device: copy(dev), areaName: areaName(dev.areaId), latest, status: roomStatus(latest), limits: limits(), series,
      stats: stats(readings(now - hours * 3_600_000, now, dev.intervalMin)),
      alerts: db.alerts.filter((a) => a.areaId === dev.areaId && ['ROOM_TEMP_HIGH', 'ROOM_TEMP_LOW', 'HUMIDITY_HIGH', 'DEVICE_OFFLINE'].includes(a.code))
        .map(alertRow).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10),
    };
  },

  // ---------- monthly report ----------
  async report(month: string, user: User): Promise<MonthReport> {
    await wait(300);
    staffOnly(user);
    const areas = visibleAreas(user);
    const inScope = (areaId: number | null) => areas === null || (areaId !== null && areas.includes(areaId));
    const ops = db.users.filter((u) => u.role === 'OPERATOR' && inScope(u.homeAreaId));
    const opIds = new Set(ops.map((o) => o.userId));
    const asg = db.assignments.filter((a) => monthOf(a.workDate) === month && opIds.has(a.operatorId));
    const ent = db.entries.filter((e) => monthOf(e.workDate) === month && opIds.has(e.operatorId) && live(e));
    const att = db.attendance.filter((a) => monthOf(a.workDate) === month && opIds.has(a.userId));
    const pct = (d: number, t: number) => (t ? Math.round((100 * d) / t) : null);

    const operators = ops.map((o) => {
      const target = asg.filter((a) => a.operatorId === o.userId).reduce((n, a) => n + a.targetBottles, 0);
      const es = ent.filter((e) => e.operatorId === o.userId);
      const handled = es.reduce((n, e) => n + e.bottlesHandled, 0);
      const count = (s: AttStatus) => att.filter((a) => a.userId === o.userId && a.status === s).length;
      return { name: o.fullName, areaName: areaName(o.homeAreaId), P: count('P'), HD: count('HD'), A: count('A'), target, handled, pct: pct(handled, target), lost: es.reduce((n, e) => n + e.bottlesLost, 0) };
    }).filter((o) => o.P + o.HD + o.A + o.target + o.handled > 0);
    const zoneNames = [...new Set(operators.map((o) => o.areaName))];
    const zones = zoneNames.map((z) => {
      const os = operators.filter((o) => o.areaName === z);
      const target = os.reduce((n, o) => n + o.target, 0);
      const handled = os.reduce((n, o) => n + o.handled, 0);
      return { areaName: z, operators: os.length, target, handled, pct: pct(handled, target), lost: os.reduce((n, o) => n + o.lost, 0) };
    });

    const trayArea = (trayId: number) => {
      const t = db.trays.find((x) => x.trayId === trayId);
      return t ? db.benches.find((b) => b.benchId === t.benchId)?.areaId ?? null : null;
    };
    const conts = db.contaminations.filter((c) => monthOf(c.foundOn) === month && inScope(trayArea(c.trayId)));
    const sumBy = <K extends string>(key: (c: (typeof conts)[number]) => K) => {
      const m = new Map<K, number>();
      for (const c of conts) m.set(key(c), (m.get(key(c)) ?? 0) + c.bottlesLost);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const stageOfTray = (trayId: number) => {
      const t = db.trays.find((x) => x.trayId === trayId);
      return db.stages.find((s) => s.stageId === t?.stageId)?.code ?? '—';
    };

    const fc = forecastRows().filter((f) => areas === null || db.trays.some((t) => t.batchId === f.batchId && t.status === 'ACTIVE' && inScope(db.benches.find((b) => b.benchId === t.benchId)?.areaId ?? null)));
    const used = new Map<number, number>();
    for (const t of db.stockTxns) if (t.txnType === 'OUT' && monthOf(t.txnDate) === month) used.set(t.itemId, (used.get(t.itemId) ?? 0) + t.qty);

    // Room conditions for the month, from the node in the user's zones.
    const dev = db.devices.find((d) => inScope(d.areaId));
    const start = new Date(month + '-01T00:00:00').getTime();
    const [yy, mm] = month.split('-').map(Number);
    const end = Math.min(Date.now(), new Date(yy, mm, 1).getTime() - 1);
    const rs = dev && end > start ? readings(start, end, dev.intervalMin) : [];
    const label = ALERT_LABEL();
    const alertCounts = new Map<string, number>();
    for (const a of db.alerts) if (monthOf(a.createdAt) === month && canSeeAlert(user, a)) alertCounts.set(label[a.code] ?? a.code, (alertCounts.get(label[a.code] ?? a.code) ?? 0) + 1);

    const isManager = user.role === 'MANAGER';
    const ordersMonth = db.orders.filter((o) => monthOf(o.createdAt) === month);
    const delMonth = db.deliveries.filter((d) => monthOf(d.sentOn) === month);
    return {
      month,
      labName: db.lab.name,
      scope: isManager ? 'Whole lab' : user.zoneIds.map((z) => areaName(z)).join(', '),
      generatedBy: user.fullName,
      generatedAt: new Date().toISOString(),
      zones, operators,
      batches: fc.map((f) => ({ batchCode: f.batchCode, byStage: f.groups.map((g) => `${g.stageCode} ${g.bottles}`).join(', '), liveBottles: f.liveBottles, expectedPlants: f.expectedPlants, readyDate: f.readyDate })),
      lossByCause: sumBy((c) => c.cause).map(([cause, bottles]) => ({ cause: cause as LossCause, bottles })),
      lossByStage: sumBy((c) => stageOfTray(c.trayId)).map(([stage, bottles]) => ({ stage, bottles })),
      stockUsed: isManager || areas?.some((a) => db.areas.find((x) => x.areaId === a)?.areaType === 'MEDIA')
        ? [...used.entries()].map(([id, qty]) => { const i = db.items.find((x) => x.itemId === id)!; return { name: i.name, unit: i.unit, qty: Math.round(qty * 100) / 100 }; }).sort((a, b) => a.name.localeCompare(b.name))
        : [],
      stockLow: db.items.filter((i) => i.stockQty <= i.reorderLevel).map((i) => ({ name: i.name, unit: i.unit, stockQty: i.stockQty, reorderLevel: i.reorderLevel })),
      money: isManager ? monthSummary(month) : null,
      orders: isManager ? { created: ordersMonth.length, plantsOrdered: ordersMonth.reduce((n, o) => n + o.plantsOrdered, 0), deliveries: delMonth.length, plantsSent: delMonth.reduce((n, d) => n + d.plantsSent, 0) } : null,
      room: rs.length ? { ...stats(rs), readings: rs.length } : null,
      alertsByCode: [...alertCounts.entries()].map(([l, count]) => ({ label: l, count })).sort((a, b) => b.count - a.count),
    };
  },

  // ---------- daily production report ----------
  async dayReport(date: string, user: User): Promise<DayReport> {
    await wait(200);
    staffOnly(user);
    need(date <= today(), 'Choose today or an earlier day.');
    const areas = visibleAreas(user);
    const inScope = (areaId: number | null) => areas === null || (areaId !== null && areas.includes(areaId));
    const ops = db.users.filter((u) => u.role === 'OPERATOR' && inScope(u.homeAreaId));
    const opIds = new Set(ops.map((o) => o.userId));
    const ent = db.entries.filter((e) => e.workDate === date && opIds.has(e.operatorId));
    const code = (stageId: number) => db.stages.find((x) => x.stageId === stageId)?.code ?? '—';
    const bcode = (batchId: number) => db.batches.find((b) => b.batchId === batchId)?.batchCode ?? '—';
    const operators = ops.map((o) => {
      const as = db.assignments.filter((a) => a.workDate === date && a.operatorId === o.userId);
      const es = ent.filter((e) => e.operatorId === o.userId);
      const ok = es.filter(live);
      const target = as.reduce((n, a) => n + a.targetBottles, 0);
      const handled = ok.reduce((n, e) => n + e.bottlesHandled, 0);
      return {
        name: o.fullName, areaName: areaName(o.homeAreaId),
        attendance: db.attendance.find((a) => a.userId === o.userId && a.workDate === date)?.status ?? null,
        work: as.map((a) => `${bcode(a.batchId)} ${code(a.stageId)}`).join(', '),
        target, handled, produced: ok.reduce((n, e) => n + e.bottlesProduced, 0), lost: ok.reduce((n, e) => n + e.bottlesLost, 0),
        pct: target ? Math.round((100 * handled) / target) : null,
        pending: es.filter((e) => e.status === 'PENDING').length,
        verified: es.filter((e) => e.status === 'VERIFIED').length,
        sentBack: es.filter((e) => e.status === 'REJECTED').length,
      };
    });
    const groups = new Map<string, { batchCode: string; stage: string; handled: number; produced: number; lost: number }>();
    for (const e of ent.filter(live)) {
      const t = db.trays.find((x) => x.trayId === e.trayId);
      if (!t) continue;
      const k = `${t.batchId}:${t.stageId}`;
      const g = groups.get(k) ?? { batchCode: bcode(t.batchId), stage: code(t.stageId), handled: 0, produced: 0, lost: 0 };
      g.handled += e.bottlesHandled;
      g.produced += e.bottlesProduced;
      g.lost += e.bottlesLost;
      groups.set(k, g);
    }
    const trayArea = (trayId: number) => {
      const t = db.trays.find((x) => x.trayId === trayId);
      return t ? db.benches.find((b) => b.benchId === t.benchId)?.areaId ?? null : null;
    };
    const label = ALERT_LABEL();
    const isMedia = areas === null || areas.some((a) => db.areas.find((x) => x.areaId === a)?.areaType === 'MEDIA');
    return {
      date, labName: db.lab.name,
      scope: user.role === 'MANAGER' ? 'Whole lab' : user.zoneIds.map((z) => areaName(z)).join(', '),
      generatedBy: user.fullName, generatedAt: new Date().toISOString(),
      operators: operators.filter((o) => o.attendance || o.target || o.handled),
      byBatch: [...groups.values()].sort((a, b) => a.batchCode.localeCompare(b.batchCode)),
      losses: db.contaminations.filter((c) => c.foundOn === date && inScope(trayArea(c.trayId))).map((c) => {
        const t = db.trays.find((x) => x.trayId === c.trayId);
        return { qrCode: t?.qrCode ?? '—', batchCode: t ? bcode(t.batchId) : '—', stage: t ? code(t.stageId) : '—', cause: c.cause, bottles: c.bottlesLost, note: c.note };
      }),
      stockUsed: isMedia ? db.stockTxns.filter((t) => t.txnDate === date && t.txnType === 'OUT').map((t) => {
        const i = db.items.find((x) => x.itemId === t.itemId);
        return { name: i?.name ?? '—', unit: i?.unit ?? '', qty: Math.round(t.qty * 100) / 100, note: t.note };
      }) : [],
      alerts: db.alerts.filter((a) => a.createdAt.slice(0, 10) === date && canSeeAlert(user, a))
        .map((a) => ({ time: new Date(a.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }), label: label[a.code] ?? a.code, message: a.message })),
    };
  },

  // ---------- audit log ----------
  async listAudit(user: User, days = 30): Promise<AuditRow[]> {
    await wait();
    managerOnly(user);
    const from = addDays(today(), -days);
    return db.audit.filter((a) => a.at.slice(0, 10) >= from).map((a) => ({ ...copy(a), userName: a.userId ? nameOf(a.userId) : 'System' })).reverse();
  },
};

/** Records one change in the audit log (keeps the newest 2,000). Called by the api wrapper in api.ts. */
export function writeAudit(userId: number | null, action: string, detail: string) {
  db.audit.push({ auditId: (db.audit[db.audit.length - 1]?.auditId ?? 0) + 1, at: new Date().toISOString(), userId, action, detail });
  if (db.audit.length > 2000) db.audit.splice(0, db.audit.length - 2000);
  save();
}

