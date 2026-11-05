// Alert checks. Each check reads the records and the limits in Set-up → Alert limits, and raises an
// alert when a limit is crossed. An alert has a key (what it is about); the same key is never raised
// twice, so an acknowledged alert does not come back unless something new happens.
// With the backend this runs on the server (every few minutes, and when a sensor reading arrives).
import { addDays, daysBetween, today } from './apiUtil';
import { latestReading, readings } from './iot';
import { db, nextId, save } from './store';
import type { AlertRule, Severity } from './types';

let lastRun = 0;

const rule = (code: string) => db.alertRules.find((r) => r.code === code);

/** WARNING / CRITICAL / null for a value against a rule (ABOVE or BELOW). */
function level(value: number, r: AlertRule): Severity | null {
  const past = (limit: number) => (r.direction === 'ABOVE' ? value > limit : value < limit);
  if (r.criticalValue !== null && past(r.criticalValue)) return 'CRITICAL';
  return past(r.warnValue) ? 'WARNING' : null;
}

function raise(code: string, key: string, severity: Severity, message: string, areaId: number | null, userId: number | null = null) {
  if (db.alerts.some((a) => a.key === key)) return false;
  db.alerts.push({ alertId: nextId(db.alerts, 'alertId'), code, areaId, severity, message, createdAt: new Date().toISOString(), ackAt: null, ackBy: null, key, userId });
  return true;
}

const benchArea = (benchId: number) => db.benches.find((b) => b.benchId === benchId)?.areaId ?? null;
const stageCode = (id: number) => db.stages.find((s) => s.stageId === id)?.code ?? '—';
const batchCode = (id: number) => db.batches.find((b) => b.batchId === id)?.batchCode ?? '—';

/** Runs every check. Called when alerts are read; runs at most once a minute. */
export function evaluateAlerts(force = false) {
  if (!force && Date.now() - lastRun < 60_000) return;
  lastRun = Date.now();
  let changed = false;

  // 1. Trays too long in one stage (initiation to rooting) and hardening trays due for a check.
  const hardening = new Set(db.stages.filter((s) => s.phase === 'HARDENING').map((s) => s.stageId));
  for (const [code, inHardening] of [['TRAY_OVERDUE', false], ['HARDENING_CHECK', true]] as const) {
    const r = rule(code);
    if (!r) continue;
    const groups = new Map<string, { batchId: number; stageId: number; areaId: number | null; days: number[]; sev: Severity }>();
    for (const t of db.trays) {
      if (t.status !== 'ACTIVE' || hardening.has(t.stageId) !== inHardening) continue;
      const d = daysBetween(t.placedOn);
      const sev = level(d, r);
      if (!sev) continue;
      const k = `${t.batchId}:${t.stageId}:${sev}`;
      const g = groups.get(k) ?? { batchId: t.batchId, stageId: t.stageId, areaId: benchArea(t.benchId), days: [], sev };
      g.days.push(d);
      groups.set(k, g);
    }
    for (const [k, g] of groups) {
      const msg = inHardening
        ? `${batchCode(g.batchId)}: ${g.days.length} hardening tray${g.days.length > 1 ? 's' : ''} in ${stageCode(g.stageId)} for ${Math.max(...g.days)} days. Count surviving plants.`
        : `${batchCode(g.batchId)}: ${g.days.length} tray${g.days.length > 1 ? 's' : ''} in ${stageCode(g.stageId)} for more than ${g.sev === 'CRITICAL' ? r.criticalValue : r.warnValue} days (oldest ${Math.max(...g.days)} days)`;
      changed = raise(code, `${code}:${k}`, g.sev, msg, g.areaId) || changed;
    }
  }

  // 2. Operators below target on the last finished working day.
  const lowOut = rule('LOW_OUTPUT');
  const lastDay = [...new Set(db.assignments.map((a) => a.workDate))].filter((d) => d < today()).sort().pop();
  if (lowOut && lastDay) {
    for (const u of db.users.filter((x) => x.role === 'OPERATOR' && x.status === 'ACTIVE')) {
      const target = db.assignments.filter((a) => a.workDate === lastDay && a.operatorId === u.userId).reduce((n, a) => n + a.targetBottles, 0);
      if (!target) continue;
      const done = db.entries.filter((e) => e.workDate === lastDay && e.operatorId === u.userId && e.status !== 'REJECTED').reduce((n, e) => n + e.bottlesHandled, 0);
      const pct = Math.round((100 * done) / target);
      const sev = level(pct, lowOut);
      if (sev) changed = raise('LOW_OUTPUT', `LOW_OUTPUT:${u.userId}:${lastDay}`, sev, `${u.fullName} did ${done} of ${target} bottles (${pct}%) on ${lastDay}`, u.homeAreaId, u.userId) || changed;
    }
  }

  // 3. Contamination loss too high in a zone over the last 7 days.
  const loss = rule('HIGH_LOSS');
  if (loss) {
    const from = addDays(today(), -7);
    const byArea = new Map<number, { handled: number; lost: number }>();
    for (const e of db.entries) {
      if (e.workDate < from || e.status === 'REJECTED') continue;
      const a = db.users.find((u) => u.userId === e.operatorId)?.homeAreaId;
      if (!a) continue;
      const x = byArea.get(a) ?? { handled: 0, lost: 0 };
      x.handled += e.bottlesHandled;
      x.lost += e.bottlesLost;
      byArea.set(a, x);
    }
    const week = Math.floor(new Date(today()).getTime() / (7 * 86_400_000));
    for (const [areaId, x] of byArea) {
      if (x.handled < 100) continue;
      const pct = Math.round((1000 * x.lost) / x.handled) / 10;
      const sev = level(pct, loss);
      const zone = db.areas.find((a) => a.areaId === areaId)?.name ?? 'Zone';
      if (sev) changed = raise('HIGH_LOSS', `HIGH_LOSS:${areaId}:${week}:${sev}`, sev, `${zone}: ${pct}% of bottles lost in the last 7 days (${x.lost} of ${x.handled})`, areaId) || changed;
    }
  }

  // 4. Stock at or below its reorder level.
  const low = rule('LOW_STOCK');
  const mediaArea = db.areas.find((a) => a.areaType === 'MEDIA')?.areaId ?? null;
  if (low) {
    for (const i of db.items) {
      if (i.reorderLevel <= 0) continue;
      const pct = (100 * i.stockQty) / i.reorderLevel;
      // "At or below" the reorder level counts, so compare as if the limit were just above it.
      const sev = pct <= (low.criticalValue ?? -1) ? 'CRITICAL' : pct <= low.warnValue ? 'WARNING' : null;
      if (!sev) continue;
      const lastIn = db.stockTxns.filter((t) => t.itemId === i.itemId && t.txnType === 'IN').reduce((m, t) => Math.max(m, t.txnId), 0);
      changed = raise('LOW_STOCK', `LOW_STOCK:${i.itemId}:${sev}:${lastIn}`, sev, `${i.name}: ${i.stockQty} ${i.unit} left (reorder at ${i.reorderLevel} ${i.unit})`, mediaArea) || changed;
    }
  }

  // 5. Growth room out of range: the last 5 readings all past the limit.
  for (const dev of db.devices) {
    const now = Date.now();
    const last5 = readings(now - 25 * 60_000, now, dev.intervalMin).slice(-5);
    const zone = db.areas.find((a) => a.areaId === dev.areaId)?.name ?? 'Room';
    const checks: [string, (r: (typeof last5)[number]) => number, string][] = [
      ['ROOM_TEMP_HIGH', (r) => r.tempC, '°C'], ['ROOM_TEMP_LOW', (r) => r.tempC, '°C'], ['HUMIDITY_HIGH', (r) => r.humidityPct, '%'],
    ];
    for (const [code, get, unit] of checks) {
      const r = rule(code);
      if (!r || last5.length < 5) continue;
      const sevs = last5.map((x) => level(get(x), r));
      if (sevs.some((s) => !s)) continue;
      const sev: Severity = sevs.every((s) => s === 'CRITICAL') ? 'CRITICAL' : 'WARNING';
      changed = raise(code, `${code}:${today()}:${sev}`, sev, `${zone} at ${get(last5[4])} ${unit} for the last 5 readings`, dev.areaId) || changed;
    }
    const off = rule('DEVICE_OFFLINE');
    const ageMin = (now - new Date(latestReading(dev.intervalMin).recordedAt).getTime()) / 60_000;
    const sev = off ? level(ageMin, off) : null;
    if (sev) changed = raise('DEVICE_OFFLINE', `DEVICE_OFFLINE:${dev.deviceId}:${today()}`, sev, `${dev.name} has not sent data for ${Math.round(ageMin)} minutes`, dev.areaId) || changed;
  }

  if (changed) save();
}
