// Alerts, dashboard, forecast and profit, room monitoring, monthly and daily reports, audit log and zone pages.
// Port of frontend/src/lib/resultsApi.ts and zonesApi.ts with the same rules.
import type { AttStatus, LossCause, Prisma, Severity } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { addDays, daysBetween, labClock, labTimeMs, labToday } from '../lib/dates.js';
import { ApiError } from '../middleware/errors.js';
import { dailyBoard, helpers, workZones, type Me } from './daily.js';
import { readingSource, type Reading } from './iot.js';
import { money, type Lab } from './lab.js';

const need: (ok: unknown, msg: string, status?: number) => asserts ok = (ok, msg, status = 400) => {
  if (!ok) throw new ApiError(status, msg);
};
const today = () => labToday();
const monthOf = (iso: string) => iso.slice(0, 7);
const live = (e: { status: string }) => e.status !== 'REJECTED';
type LabAlert = Lab['alerts'][number];
const visibleAreas = (me: Me): number[] | null => (me.role === 'MANAGER' ? null : me.role === 'SUPERVISOR' ? me.zoneIds : workZones(me));

/** Alerts a user may see: manager all; supervisor own zones; operator own zones, minus alerts about other operators. */
export function canSeeAlert(me: Me, a: { areaId: number | null; userId: number | null }) {
  if (me.role === 'MANAGER') return true;
  if (me.role === 'SUPERVISOR') return a.areaId !== null && me.zoneIds.includes(a.areaId);
  return a.areaId !== null && workZones(me).includes(a.areaId) && (!a.userId || a.userId === me.userId);
}

const areaName = (L: Lab, id: number | null) => L.areas.find((a) => a.areaId === id)?.name ?? 'Whole lab';
const labels = (L: Lab) => Object.fromEntries(L.rules.map((r) => [r.code, r.label])) as Record<string, string>;

function alertRow(L: Lab, a: LabAlert) {
  const h = helpers(L);
  const { createdDate: _d, ...rest } = a;
  return { ...rest, areaName: areaName(L, a.areaId), ackByName: a.ackBy ? h.nameOf(a.ackBy) : null, label: labels(L)[a.code] ?? a.code };
}

function limits(L: Lab) {
  const pair = (code: string): [number, number | null] | null => {
    const r = L.rules.find((x) => x.code === code);
    return r ? [r.warnValue, r.criticalValue] : null;
  };
  return { tempHigh: pair('ROOM_TEMP_HIGH'), tempLow: pair('ROOM_TEMP_LOW'), humidityHigh: pair('HUMIDITY_HIGH') };
}

function roomStatus(L: Lab, r: Reading) {
  const l = limits(L);
  const hi = (v: number, p: [number, number | null] | null): Severity | null => (!p ? null : p[1] !== null && v > p[1] ? 'CRITICAL' : v > p[0] ? 'WARNING' : null);
  const lo = (v: number, p: [number, number | null] | null): Severity | null => (!p ? null : p[1] !== null && v < p[1] ? 'CRITICAL' : v < p[0] ? 'WARNING' : null);
  return { temp: hi(r.tempC, l.tempHigh) ?? lo(r.tempC, l.tempLow), humidity: hi(r.humidityPct, l.humidityHigh) };
}

function stats(rs: Reading[]) {
  const avg = (xs: number[]) => Math.round((xs.reduce((n, x) => n + x, 0) / Math.max(1, xs.length)) * 10) / 10;
  const t = rs.map((r) => r.tempC);
  const hm = rs.map((r) => r.humidityPct);
  return { tempMin: Math.min(...t), tempMax: Math.max(...t), tempAvg: avg(t), humMin: Math.min(...hm), humMax: Math.max(...hm), humAvg: avg(hm) };
}

/** Sale rate per plant for a crop: weighted average of its orders, else the default rate in the forecast assumptions. */
function rateOf(L: Lab, cropId: number) {
  const os = L.orders.filter((o) => o.cropId === cropId && o.status !== 'CANCELLED');
  const plants = os.reduce((n, o) => n + o.plantsOrdered, 0);
  if (plants > 0) return { rate: Math.round((os.reduce((n, o) => n + o.plantsOrdered * o.ratePerPlant, 0) / plants) * 100) / 100, fromOrders: true };
  return { rate: L.settings.defaultRate ?? 15, fromOrders: false };
}

export function forecastRows(L: Lab) {
  return money(L).forecastAll().map((f) => {
    const crop = L.crops.find((x) => x.cropId === f.cropId);
    const { rate, fromOrders } = rateOf(L, f.cropId);
    const main = [...f.groups].sort((a, b) => b.bottles - a.bottles)[0];
    const expectedRevenue = f.expectedPlants * rate;
    return { ...f, cropName: crop ? `${crop.name} ${crop.variety}` : '—', mainStage: main?.stageCode ?? '—', rate, rateFromOrders: fromOrders, expectedRevenue, expectedProfit: expectedRevenue - f.expectedCost };
  });
}

// ---------- alerts ----------
export const listAlerts = (L: Lab, me: Me) =>
  L.alerts.filter((a) => canSeeAlert(me, a)).map((a) => alertRow(L, a)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export async function acknowledgeAlerts(tx: Prisma.TransactionClient, me: Me, ids: number[]) {
  need(ids.length > 0, 'Choose at least one alert.');
  const rows = await tx.alert.findMany({ where: { alertId: { in: ids } } });
  for (const id of ids) {
    const a = rows.find((x) => x.alertId === id);
    need(a && canSeeAlert(me, a), 'Alert not found.', 404);
  }
  await tx.alert.updateMany({ where: { alertId: { in: ids }, ackAt: null }, data: { ackAt: new Date(), ackBy: me.userId } });
}

// ---------- dashboard ----------
export async function dashboard(L: Lab) {
  const fc = forecastRows(L);
  const m = money(L);
  const t = today();
  const todays = L.ents.filter((e) => e.workDate === t && live(e));
  const ops = L.users.filter((u) => u.role === 'OPERATOR' && u.status === 'ACTIVE');
  const from30 = addDays(t, -30);
  const e30 = L.ents.filter((e) => e.workDate >= from30 && live(e));
  const causeTotals = new Map<LossCause, number>();
  for (const x of L.conts) if (x.foundOn >= from30) causeTotals.set(x.cause, (causeTotals.get(x.cause) ?? 0) + x.bottlesLost);
  const daily: { date: string; handled: number; target: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(t, -i);
    const target = L.asgs.filter((a) => a.workDate === d).reduce((n, a) => n + a.targetBottles + a.targetContaminated, 0);
    const handled = e30.filter((e) => e.workDate === d).reduce((n, e) => n + e.bottlesHandled, 0);
    if (target || handled) daily.push({ date: d, handled, target });
  }
  const [y, mo] = t.slice(0, 7).split('-').map(Number);
  const prev = new Date(Date.UTC(y, mo - 2, 1));
  const lastMonth = m.monthSummary(`${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`);
  const open = L.orders.filter((o) => o.status === 'OPEN');
  const dev = L.devices[0];
  const src = dev ? await readingSource(dev.deviceId, dev.intervalMin) : null;
  const r = src ? await src.latest() : null;
  const in180 = addDays(t, 180);
  return {
    runningBatches: fc.length,
    liveBottles: fc.reduce((n, f) => n + f.liveBottles, 0),
    today: {
      target: L.asgs.filter((a) => a.workDate === t).reduce((n, a) => n + a.targetBottles + a.targetContaminated, 0),
      handled: todays.reduce((n, e) => n + e.bottlesHandled, 0),
      present: L.atts.filter((a) => a.workDate === t && a.status !== 'A').length,
      operators: ops.length,
    },
    loss30: {
      handled: e30.filter((e) => e.kind === 'SUBCULTURE').reduce((n, e) => n + e.bottlesHandled, 0),
      lost: e30.filter((e) => e.kind === 'SUBCULTURE').reduce((n, e) => n + e.bottlesLost, 0),
      byCause: [...causeTotals.entries()].map(([cause, bottles]) => ({ cause, bottles })).sort((a, b) => b.bottles - a.bottles),
    },
    daily,
    plantsNext180: fc.flatMap((f) => f.groups).filter((g) => g.readyDate <= in180).reduce((n, g) => n + g.expectedPlants, 0),
    openOrders: open.length,
    plantsToSend: open.reduce((n, o) => n + Math.max(0, o.plantsPromised - L.deliveries.filter((d) => d.orderId === o.orderId).reduce((k, d) => k + d.plantsSent, 0)), 0),
    lastMonth,
    batches: fc.map((f) => ({ batchId: f.batchId, batchCode: f.batchCode, mainStage: f.mainStage, liveBottles: f.liveBottles, expectedPlants: f.expectedPlants, readyDate: f.readyDate })),
    room: dev && r ? { reading: r, deviceName: dev.name, areaName: areaName(L, dev.areaId), simulated: src!.simulated, ...roomStatus(L, r) } : null,
  };
}

// ---------- room monitoring ----------
export async function room(L: Lab, me: Me, hours: number) {
  const dev = L.devices.find((d) => me.role === 'MANAGER' || me.zoneIds.includes(d.areaId));
  if (!dev) return null;
  const src = await readingSource(dev.deviceId, dev.intervalMin);
  const now = Date.now();
  // Every reading for a day; for a week, one every 30 minutes keeps the chart light.
  const step = hours > 48 ? 30 : dev.intervalMin;
  const series = await src.between(now - hours * 3_600_000, now, step);
  const all = step === dev.intervalMin ? series : await src.between(now - hours * 3_600_000, now, dev.intervalMin);
  const latest = await src.latest();
  return {
    device: dev, areaName: areaName(L, dev.areaId), simulated: src.simulated,
    latest, status: latest ? roomStatus(L, latest) : { temp: null, humidity: null }, limits: limits(L), series,
    stats: all.length ? stats(all) : null,
    alerts: L.alerts.filter((a) => a.areaId === dev.areaId && ['ROOM_TEMP_HIGH', 'ROOM_TEMP_LOW', 'HUMIDITY_HIGH', 'DEVICE_OFFLINE'].includes(a.code))
      .map((a) => alertRow(L, a)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10),
  };
}

// ---------- monthly report ----------
export async function monthReport(L: Lab, me: Me, month: string) {
  const h = helpers(L);
  const areas = visibleAreas(me);
  const inScope = (areaId: number | null) => areas === null || (areaId !== null && areas.includes(areaId));
  const ops = L.users.filter((u) => u.role === 'OPERATOR' && workZones(u).some(inScope));
  const opIds = new Set(ops.map((o) => o.userId));
  const asg = L.asgs.filter((a) => monthOf(a.workDate) === month && opIds.has(a.operatorId) && inScope(h.assignArea(a)));
  const ent = L.ents.filter((e) => monthOf(e.workDate) === month && opIds.has(e.operatorId) && live(e) && inScope(h.entryArea(e)));
  const att = L.atts.filter((a) => monthOf(a.workDate) === month && opIds.has(a.userId));
  const pct = (d: number, t: number) => (t ? Math.round((100 * d) / t) : null);
  const targetOf = (a: (typeof asg)[number]) => a.targetBottles + a.targetContaminated;

  const operators = ops.map((o) => {
    const target = asg.filter((a) => a.operatorId === o.userId).reduce((n, a) => n + targetOf(a), 0);
    const es = ent.filter((e) => e.operatorId === o.userId);
    const handled = es.reduce((n, e) => n + e.bottlesHandled, 0);
    const count = (s: AttStatus) => att.filter((a) => a.userId === o.userId && a.status === s).length;
    return { name: o.fullName, areaName: workZones(o).filter(inScope).map((z) => areaName(L, z)).join(', '), P: count('P'), HD: count('HD'), A: count('A'), target, handled, pct: pct(handled, target), lost: es.reduce((n, e) => n + (e.kind === 'SUBCULTURE' ? e.bottlesLost : 0), 0) };
  }).filter((o) => o.P + o.HD + o.A + o.target + o.handled > 0);
  const zoneIds = [...new Set([...asg.map(h.assignArea), ...ent.map(h.entryArea)].filter((z): z is number => z !== null))];
  const zones = zoneIds.map((z) => {
    const za = asg.filter((a) => h.assignArea(a) === z);
    const ze = ent.filter((e) => h.entryArea(e) === z);
    const target = za.reduce((n, a) => n + targetOf(a), 0);
    const handled = ze.reduce((n, e) => n + e.bottlesHandled, 0);
    return { areaName: areaName(L, z), operators: new Set([...za.map((a) => a.operatorId), ...ze.map((e) => e.operatorId)]).size, target, handled, pct: pct(handled, target), lost: ze.reduce((n, e) => n + (e.kind === 'SUBCULTURE' ? e.bottlesLost : 0), 0) };
  }).sort((a, b) => a.areaName.localeCompare(b.areaName));

  const trayArea = (trayId: number) => {
    const t = h.trayOf(trayId);
    return t ? h.benchOf(t.benchId)?.areaId ?? null : null;
  };
  const conts = L.conts.filter((x) => monthOf(x.foundOn) === month && inScope(trayArea(x.trayId)));
  const sumBy = (key: (x: (typeof conts)[number]) => string) => {
    const m = new Map<string, number>();
    for (const x of conts) m.set(key(x), (m.get(key(x)) ?? 0) + x.bottlesLost);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const stageOfTray = (trayId: number) => h.stageCode(h.trayOf(trayId)?.stageId);

  const fc = forecastRows(L).filter((f) => areas === null || L.trays.some((t) => t.batchId === f.batchId && t.status === 'ACTIVE' && inScope(h.benchOf(t.benchId)?.areaId ?? null)));
  const used = new Map<number, number>();
  for (const t of L.txns) if (t.txnType === 'OUT' && monthOf(t.txnDate) === month) used.set(t.itemId, (used.get(t.itemId) ?? 0) + t.qty);

  // Room conditions for the month, from the node in the user's zones.
  const dev = L.devices.find((d) => inScope(d.areaId));
  const start = labTimeMs(`${month}-01`, '00:00');
  const [yy, mm] = month.split('-').map(Number);
  const nextMonth = `${mm === 12 ? yy + 1 : yy}-${String(mm === 12 ? 1 : mm + 1).padStart(2, '0')}-01`;
  const end = Math.min(Date.now(), labTimeMs(nextMonth, '00:00') - 1);
  const src = dev ? await readingSource(dev.deviceId, dev.intervalMin) : null;
  const rs = src && end > start ? await src.between(start, end, dev!.intervalMin) : [];
  const label = labels(L);
  const alertCounts = new Map<string, number>();
  for (const a of L.alerts) if (monthOf(a.createdDate) === month && canSeeAlert(me, a)) alertCounts.set(label[a.code] ?? a.code, (alertCounts.get(label[a.code] ?? a.code) ?? 0) + 1);

  const isManager = me.role === 'MANAGER';
  const m = money(L);
  const ordersMonth = L.orders.filter((o) => monthOf(o.createdDate) === month);
  const delMonth = L.deliveries.filter((d) => monthOf(d.sentOn) === month);
  return {
    month,
    labName: L.lab.name,
    scope: isManager ? 'Whole lab' : me.zoneIds.map((z) => areaName(L, z)).join(', '),
    generatedBy: h.nameOf(me.userId),
    generatedAt: new Date().toISOString(),
    zones, operators,
    batches: fc.map((f) => ({ batchCode: f.batchCode, byStage: f.groups.map((g) => `${g.stageCode} ${g.bottles}`).join(', '), liveBottles: f.liveBottles, expectedPlants: f.expectedPlants, readyDate: f.readyDate })),
    lossByCause: sumBy((x) => x.cause).map(([cause, bottles]) => ({ cause: cause as LossCause, bottles })),
    lossByStage: sumBy((x) => stageOfTray(x.trayId)).map(([stage, bottles]) => ({ stage, bottles })),
    stockUsed: isManager || areas?.some((a) => h.areaOf(a)?.areaType === 'MEDIA')
      ? [...used.entries()].map(([id, qty]) => { const i = L.items.find((x) => x.itemId === id)!; return { name: i.name, unit: i.unit, qty: Math.round(qty * 100) / 100 }; }).sort((a, b) => a.name.localeCompare(b.name))
      : [],
    stockLow: L.items.filter((i) => i.stockQty <= i.reorderLevel).map((i) => ({ name: i.name, unit: i.unit, stockQty: i.stockQty, reorderLevel: i.reorderLevel })),
    money: isManager ? m.monthSummary(month) : null,
    orders: isManager ? { created: ordersMonth.length, plantsOrdered: ordersMonth.reduce((n, o) => n + o.plantsOrdered, 0), deliveries: delMonth.length, plantsSent: delMonth.reduce((n, d) => n + d.plantsSent, 0) } : null,
    room: rs.length ? { ...stats(rs), readings: rs.length, simulated: src!.simulated } : null,
    alertsByCode: [...alertCounts.entries()].map(([l, count]) => ({ label: l, count })).sort((a, b) => b.count - a.count),
  };
}

// ---------- daily production report ----------
export function dayReport(L: Lab, me: Me, date: string) {
  const h = helpers(L);
  need(date <= today(), 'Choose today or an earlier day.');
  const areas = visibleAreas(me);
  const inScope = (areaId: number | null) => areas === null || (areaId !== null && areas.includes(areaId));
  const ops = L.users.filter((u) => u.role === 'OPERATOR' && workZones(u).some(inScope));
  const opIds = new Set(ops.map((o) => o.userId));
  const ent = L.ents.filter((e) => e.workDate === date && opIds.has(e.operatorId) && inScope(h.entryArea(e)));
  const operators = ops.map((o) => {
    const as = L.asgs.filter((a) => a.workDate === date && a.operatorId === o.userId && inScope(h.assignArea(a)));
    const es = ent.filter((e) => e.operatorId === o.userId);
    const ok = es.filter(live);
    const target = as.reduce((n, a) => n + a.targetBottles + a.targetContaminated, 0);
    const handled = ok.reduce((n, e) => n + e.bottlesHandled, 0);
    return {
      name: o.fullName, areaName: workZones(o).filter(inScope).map((z) => areaName(L, z)).join(', '),
      attendance: h.attOf(o.userId, date),
      work: as.map((a) => h.workLabel(a)).join(', '),
      target, handled, produced: ok.reduce((n, e) => n + e.bottlesProduced, 0), lost: ok.reduce((n, e) => n + (e.kind === 'SUBCULTURE' ? e.bottlesLost : 0), 0),
      pct: target ? Math.round((100 * handled) / target) : null,
      pending: es.filter((e) => e.status === 'PENDING').length,
      verified: es.filter((e) => e.status === 'VERIFIED').length,
      sentBack: es.filter((e) => e.status === 'REJECTED').length,
    };
  });
  const groups = new Map<string, { batchCode: string; stage: string; handled: number; produced: number; lost: number }>();
  for (const e of ent.filter(live)) {
    const b = h.entryBatch(e);
    const st = h.entryStage(e);
    if (e.kind !== 'SUBCULTURE' || b === null || st === null) continue;
    const k = `${b}:${st}`;
    const g = groups.get(k) ?? { batchCode: h.batchCode(b), stage: h.stageCode(st), handled: 0, produced: 0, lost: 0 };
    g.handled += e.bottlesHandled;
    g.produced += e.bottlesProduced;
    g.lost += e.bottlesLost;
    groups.set(k, g);
  }
  const trayArea = (trayId: number) => {
    const t = h.trayOf(trayId);
    return t ? h.benchOf(t.benchId)?.areaId ?? null : null;
  };
  const label = labels(L);
  const isMedia = areas === null || areas.some((a) => h.areaOf(a)?.areaType === 'MEDIA');
  return {
    date, labName: L.lab.name,
    scope: me.role === 'MANAGER' ? 'Whole lab' : me.zoneIds.map((z) => areaName(L, z)).join(', '),
    generatedBy: h.nameOf(me.userId), generatedAt: new Date().toISOString(),
    operators: operators.filter((o) => o.attendance || o.target || o.handled),
    byBatch: [...groups.values()].sort((a, b) => a.batchCode.localeCompare(b.batchCode)),
    losses: L.conts.filter((x) => x.foundOn === date && inScope(trayArea(x.trayId))).map((x) => {
      const t = h.trayOf(x.trayId);
      return { qrCode: t?.qrCode ?? '—', batchCode: t ? h.batchCode(t.batchId) : '—', stage: t ? h.stageCode(t.stageId) : '—', cause: x.cause, bottles: x.bottlesLost, note: x.note };
    }),
    stockUsed: isMedia ? L.txns.filter((t) => t.txnDate === date && t.txnType === 'OUT').map((t) => {
      const i = L.items.find((x) => x.itemId === t.itemId);
      return { name: i?.name ?? '—', unit: i?.unit ?? '', qty: Math.round(t.qty * 100) / 100, note: t.note };
    }) : [],
    alerts: L.alerts.filter((a) => a.createdDate === date && canSeeAlert(me, a)).map((a) => ({ time: labClock(a.createdAt), label: label[a.code] ?? a.code, message: a.message })),
  };
}

// ---------- audit log ----------
export async function listAudit(days = 30) {
  const from = new Date(labTimeMs(addDays(today(), -days), '00:00'));
  const rows = await prisma.auditLog.findMany({ where: { at: { gte: from } }, orderBy: { auditId: 'desc' }, include: { user: { select: { fullName: true } } }, take: 5000 });
  return rows.map(({ user, ...a }) => ({ ...a, at: a.at.toISOString(), userName: user?.fullName ?? 'System' }));
}

// ---------- zones ----------
const ZONE_PURPOSE: Record<string, string> = {
  WASH: 'Bottles and glassware are washed and dried here before media is poured.',
  MEDIA: 'Culture media is prepared, poured into bottles and sterilised here.',
  INOCULATION: 'Operators sub-culture bottles under the laminar flow hoods here.',
  INCUBATION: 'Trays of cultures grow on racks here under controlled light and temperature.',
  QC: 'Media bottles and culture bottles are checked here before they are used or moved on.',
  HARDENING: 'Rooted plants are moved to cocopeat and polybags and slowly get used to outside conditions.',
  STORE: 'Chemicals, bottles and other material are kept here.',
};

type Overdue = 'OK' | 'WARNING' | 'CRITICAL';
function overdueLevel(L: Lab, days: number): Overdue {
  const r = L.rules.find((x) => x.code === 'TRAY_OVERDUE');
  if (!r) return 'OK';
  if (r.criticalValue !== null && days > r.criticalValue) return 'CRITICAL';
  return days > r.warnValue ? 'WARNING' : 'OK';
}

function myZones(L: Lab, me: Me) {
  need(me.role !== 'OPERATOR', 'Only a supervisor or manager can see zones.', 403);
  const allowed = visibleAreas(me);
  return L.areas.filter((a) => allowed === null || allowed.includes(a.areaId));
}

async function zoneSummary(L: Lab, areaId: number, date: string) {
  const h = helpers(L);
  const area = h.areaOf(areaId)!;
  const ops = L.users.filter((u) => u.role === 'OPERATOR' && u.status === 'ACTIVE' && workZones(u).includes(areaId));
  const opIds = new Set(ops.map((o) => o.userId));
  const att = L.atts.filter((a) => a.workDate === date && opIds.has(a.userId));
  const target = L.asgs.filter((a) => a.workDate === date && h.assignArea(a) === areaId).reduce((n, a) => n + a.targetBottles + a.targetContaminated, 0);
  const handled = L.ents.filter((e) => e.workDate === date && h.entryArea(e) === areaId && live(e)).reduce((n, e) => n + e.bottlesHandled, 0);
  const benches = L.benches.filter((b) => b.areaId === areaId);
  const benchIds = new Set(benches.map((b) => b.benchId));
  const trays = L.trays.filter((t) => t.status === 'ACTIVE' && benchIds.has(t.benchId));
  const from30 = addDays(today(), -30);
  const trayIdsHere = new Set(L.trays.filter((t) => benchIds.has(t.benchId)).map((t) => t.trayId));
  const open = L.alerts.filter((a) => a.areaId === areaId && !a.ackAt);
  const dev = L.devices.find((d) => d.areaId === areaId);
  const src = dev ? await readingSource(dev.deviceId, dev.intervalMin) : null;
  const r = src ? await src.latest() : null;
  let media: { lots: number; bottles: number; lowStock: number } | null = null;
  if (area.areaType === 'MEDIA') {
    const usable = L.lots.filter((l) => today() <= l.expiresOn).map((l) => Math.max(0, l.bottlesFilled - h.lotUsed(l.mediaLotId))).filter((left) => left > 0);
    media = { lots: usable.length, bottles: usable.reduce((n, x) => n + x, 0), lowStock: L.items.filter((i) => i.stockQty <= i.reorderLevel).length };
  }
  return {
    areaId, name: area.name, areaType: area.areaType, roomNo: area.roomNo,
    supervisors: L.users.filter((u) => u.role === 'SUPERVISOR' && u.status === 'ACTIVE' && u.zoneIds.includes(areaId)).map((u) => u.fullName),
    operators: ops.length,
    present: att.filter((a) => a.status !== 'A').length,
    marked: att.length,
    target, handled, pct: target ? Math.round((100 * handled) / target) : null,
    trays: trays.length,
    bottles: trays.reduce((n, t) => n + t.bottleCount, 0),
    overdueTrays: trays.filter((t) => overdueLevel(L, daysBetween(t.placedOn)) !== 'OK' && h.stageOf(t.stageId)?.phase !== 'HARDENING').length,
    benches: benches.length,
    capacity: benches.reduce((n, b) => n + b.capacityTrays, 0),
    lost30: L.conts.filter((x) => x.foundOn >= from30 && trayIdsHere.has(x.trayId)).reduce((n, x) => n + x.bottlesLost, 0),
    openAlerts: open.length,
    criticalAlerts: open.filter((a) => a.severity === 'CRITICAL').length,
    room: r ? { tempC: r.tempC, humidityPct: r.humidityPct, status: roomSeverity(L, r), simulated: src!.simulated } : null,
    media,
    wash: area.areaType === 'WASH' ? h.washPool() : null,
  };
}

function roomSeverity(L: Lab, r: Reading): Severity | null {
  const s = roomStatus(L, r);
  return s.temp === 'CRITICAL' || s.humidity === 'CRITICAL' ? 'CRITICAL' : s.temp || s.humidity ? 'WARNING' : null;
}

export async function zoneSummaries(L: Lab, me: Me, date: string) {
  const out = [];
  for (const a of myZones(L, me)) out.push(await zoneSummary(L, a.areaId, date));
  return out;
}

export async function zoneDetail(L: Lab, me: Me, areaId: number, date: string) {
  const h = helpers(L);
  const area = myZones(L, me).find((a) => a.areaId === areaId);
  need(area, 'Zone not found, or not one of your zones.', 404);
  const s = await zoneSummary(L, areaId, date);
  const benches = L.benches.filter((b) => b.areaId === areaId);
  const benchIds = new Set(benches.map((b) => b.benchId));
  const active = L.trays.filter((t) => t.status === 'ACTIVE' && benchIds.has(t.benchId));

  const groups = new Map<string, { batchId: number; batchCode: string; stage: string; trays: number; bottles: number; oldestDays: number; overdue: Overdue }>();
  const hardening = new Set(L.stages.filter((x) => x.phase === 'HARDENING').map((x) => x.stageId));
  for (const t of active) {
    const k = `${t.batchId}:${t.stageId}`;
    const days = daysBetween(t.placedOn);
    const g = groups.get(k) ?? { batchId: t.batchId, batchCode: h.batchCode(t.batchId), stage: h.stageCode(t.stageId), trays: 0, bottles: 0, oldestDays: 0, overdue: 'OK' as Overdue };
    g.trays++;
    g.bottles += t.bottleCount;
    g.oldestDays = Math.max(g.oldestDays, days);
    if (!hardening.has(t.stageId)) g.overdue = overdueLevel(L, g.oldestDays);
    groups.set(k, g);
  }
  const seq = (code: string) => L.stages.find((x) => x.code === code)?.seqNo ?? 0;

  const from30 = addDays(today(), -30);
  const trayIdsHere = new Set(L.trays.filter((t) => benchIds.has(t.benchId)).map((t) => t.trayId));
  const causes = new Map<LossCause, number>();
  for (const x of L.conts) if (x.foundOn >= from30 && trayIdsHere.has(x.trayId)) causes.set(x.cause, (causes.get(x.cause) ?? 0) + x.bottlesLost);

  const ops = new Set(L.users.filter((u) => u.role === 'OPERATOR' && workZones(u).includes(areaId)).map((u) => u.userId));
  const daily: { date: string; handled: number; target: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(date, -i);
    const target = L.asgs.filter((a) => a.workDate === d && h.assignArea(a) === areaId).reduce((n, a) => n + a.targetBottles + a.targetContaminated, 0);
    const handled = L.ents.filter((e) => e.workDate === d && h.entryArea(e) === areaId && live(e)).reduce((n, e) => n + e.bottlesHandled, 0);
    if (target || handled) daily.push({ date: d, handled, target });
  }

  const dev = L.devices.find((d) => d.areaId === areaId);
  const now = Date.now();
  const board = dailyBoard(L, me, date, areaId).filter((r) => ops.has(r.operatorId));
  const lowOut = L.rules.find((r) => r.code === 'LOW_OUTPUT');
  const pct = s.pct;
  const level = pct === null || date >= today() ? 'NONE' : lowOut && lowOut.criticalValue !== null && pct < lowOut.criticalValue ? 'CRITICAL' : lowOut && pct < lowOut.warnValue ? 'WARNING' : 'OK';
  const src = dev ? await readingSource(dev.deviceId, dev.intervalMin) : null;

  return {
    ...s,
    purpose: ZONE_PURPOSE[area.areaType] ?? '',
    board,
    byStage: [...groups.values()].sort((a, b) => a.batchCode.localeCompare(b.batchCode) || seq(a.stage) - seq(b.stage)),
    benchLoad: benches.map((b) => ({ benchId: b.benchId, code: b.code, trays: active.filter((t) => t.benchId === b.benchId).length, capacity: b.capacityTrays })),
    lossByCause: [...causes.entries()].map(([cause, bottles]) => ({ cause, bottles })).sort((a, b) => b.bottles - a.bottles),
    daily,
    alerts: L.alerts.filter((a) => a.areaId === areaId && !a.ackAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ createdDate: _d, ...a }) => ({ ...a, label: labels(L)[a.code] ?? a.code })),
    roomSeries: src ? await src.between(now - 24 * 3_600_000, now, dev!.intervalMin) : [],
    mediaLots: area.areaType === 'MEDIA'
      ? L.lots.filter((l) => today() <= l.expiresOn).map((l) => ({ lotCode: l.lotCode, recipe: h.recipeCode(l.recipeId), bottlesLeft: Math.max(0, l.bottlesFilled - h.lotUsed(l.mediaLotId)), expiresOn: l.expiresOn })).filter((l) => l.bottlesLeft > 0)
      : [],
    lowStock: area.areaType === 'MEDIA' ? L.items.filter((i) => i.stockQty <= i.reorderLevel).map((i) => ({ name: i.name, stockQty: i.stockQty, unit: i.unit, reorderLevel: i.reorderLevel })) : [],
    level,
  };
}
