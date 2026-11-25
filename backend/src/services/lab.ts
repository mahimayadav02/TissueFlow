// Everything the results pages need, loaded once per request, plus the forecast and cost formulas
// (port of frontend/src/lib/forecast.ts) and the alert checks (port of frontend/src/lib/alertEngine.ts).
//   cost per bottle-round = lab costs of the month ÷ bottles handled that month
//   batch cost so far     = Σ (bottles of the batch handled in a month × that month's cost per bottle-round)
//   expected plants       = bottles now × growth ^ rounds left × rooting survival × hardening survival
//   expected cost         = cost so far + remaining bottle-rounds × cost per bottle-round
import type { CostHeading, Phase, Prisma, Severity, Stage } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { addDays, daysBetween, isoDate, labDate, labToday } from '../lib/dates.js';
import { helpers, loadCtx } from './daily.js';
import { readingSource } from './iot.js';

type Db = Prisma.TransactionClient;
const today = () => labToday();
const monthOf = (iso: string) => iso.slice(0, 7);

export async function loadLab(db: Db = prisma) {
  const [c, lab, rules, items, txns, costs, orders, deliveries, alerts, devices, settings] = await Promise.all([
    loadCtx(db),
    db.lab.findFirstOrThrow({ orderBy: { labId: 'asc' } }),
    db.alertRule.findMany({ orderBy: { ruleId: 'asc' } }),
    db.item.findMany({ orderBy: { itemId: 'asc' } }),
    db.stockTxn.findMany({ orderBy: { txnId: 'asc' } }),
    db.costEntry.findMany({ orderBy: { costId: 'asc' } }),
    db.salesOrder.findMany({ orderBy: { orderId: 'asc' } }),
    db.delivery.findMany({ orderBy: { deliveryId: 'asc' } }),
    db.alert.findMany({ orderBy: { alertId: 'asc' } }),
    db.sensorDevice.findMany({ orderBy: { deviceId: 'asc' }, select: { deviceId: true, name: true, areaId: true, intervalMin: true } }),
    db.settings.findUniqueOrThrow({ where: { settingsId: 1 } }),
  ]);
  return {
    ...c,
    lab, rules, items, devices,
    settings: { rootingSurvival: settings.rootingSurvival, hardeningSurvival: settings.hardeningSurvival, lastMultiplicationStage: settings.lastMultiplicationStage, defaultRate: settings.defaultRate ?? undefined },
    txns: txns.map((t) => ({ ...t, txnDate: isoDate(t.txnDate) })),
    costs: costs.map((x) => ({ ...x, amount: Number(x.amount) })),
    orders: orders.map((o) => ({ ...o, ratePerPlant: Number(o.ratePerPlant), requiredBy: isoDate(o.requiredBy), createdAt: o.createdAt.toISOString(), createdDate: labDate(o.createdAt) })),
    deliveries: deliveries.map((d) => ({ ...d, sentOn: isoDate(d.sentOn) })),
    alerts: alerts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), createdDate: labDate(a.createdAt), ackAt: a.ackAt?.toISOString() ?? null })),
  };
}
export type Lab = Awaited<ReturnType<typeof loadLab>>;
type LabStage = Lab['stages'][number];

// =====================================================================================================
// Forecast and costs
// =====================================================================================================
const PHASE_ORDER: Record<Phase, number> = { INITIATION: 0, MULTIPLICATION: 1, ROOTING: 2, HARDENING: 3 };
export const avgDays = (s: Pick<Stage, 'minDays' | 'maxDays'>) => (s.minDays + s.maxDays) / 2;
const isBenchMove = (m: { fromStageId: number; toStageId: number; bottlesIn: number; bottlesOut: number; bottlesLost: number }) =>
  m.fromStageId === m.toStageId && m.bottlesIn === m.bottlesOut && m.bottlesLost === 0;

export interface MonthSummary {
  month: string;
  byHeading: Partial<Record<CostHeading, number>>;
  totalCost: number;
  bottlesHandled: number;
  costPerBottle: number | null;
  plantsSent: number;
  revenue: number;
  profit: number;
}

export interface ForecastGroup {
  batchId: number;
  batchCode: string;
  cropId: number;
  stageCode: string;
  bottles: number;
  roundsLeft: number;
  expectedPlants: number;
  readyDate: string;
  futureHandlings: number;
}

export function money(L: Lab) {
  const h = helpers(L);
  // Cached for this load: handlings are needed by every month summary.
  let handlingsMemo: { date: string; batchId: number; bottles: number }[] | null = null;
  /** Every sub-culture: operator entries, plus stage moves done by supervisors (which have no entry). */
  const handlings = () => {
    if (handlingsMemo) return handlingsMemo;
    const linked = new Set(L.ents.filter((e) => e.movementId !== null).map((e) => e.movementId));
    const out: { date: string; batchId: number; bottles: number }[] = [];
    for (const e of L.ents) {
      if (e.status === 'REJECTED' || e.kind !== 'SUBCULTURE') continue;
      const batchId = h.entryBatch(e);
      if (batchId !== null) out.push({ date: e.workDate, batchId, bottles: e.bottlesHandled });
    }
    for (const m of L.movs) {
      if (linked.has(m.movementId) || isBenchMove(m)) continue;
      out.push({ date: m.movedDate, batchId: m.batchId, bottles: m.bottlesIn });
    }
    return (handlingsMemo = out);
  };

  const monthSummary = (month: string): MonthSummary => {
    const byHeading: Partial<Record<CostHeading, number>> = {};
    for (const x of L.costs) if (x.month === month) byHeading[x.heading] = (byHeading[x.heading] ?? 0) + x.amount;
    const totalCost = Object.values(byHeading).reduce((n, v) => n + (v ?? 0), 0);
    const bottlesHandled = handlings().filter((x) => monthOf(x.date) === month).reduce((n, x) => n + x.bottles, 0);
    let plantsSent = 0;
    let revenue = 0;
    for (const d of L.deliveries) {
      if (monthOf(d.sentOn) !== month) continue;
      const o = L.orders.find((x) => x.orderId === d.orderId);
      plantsSent += d.plantsSent;
      revenue += d.plantsSent * (o?.ratePerPlant ?? 0);
    }
    return {
      month, byHeading, totalCost, bottlesHandled,
      costPerBottle: totalCost > 0 && bottlesHandled > 0 ? totalCost / bottlesHandled : null,
      plantsSent, revenue, profit: revenue - totalCost,
    };
  };

  const knownMonths = () => {
    const set = new Set<string>([monthOf(today())]);
    for (const x of L.costs) set.add(x.month);
    for (const x of handlings()) set.add(monthOf(x.date));
    for (const d of L.deliveries) set.add(monthOf(d.sentOn));
    return [...set].sort().reverse();
  };

  /** Cost per bottle-round for a month: its own, else the nearest earlier month's, else the nearest later month's. */
  const rateCache = new Map<string, number | null>();
  const rateFor = (month: string): number => {
    const known = (m: string) => {
      if (!rateCache.has(m)) rateCache.set(m, monthSummary(m).costPerBottle);
      return rateCache.get(m)!;
    };
    const months = [...new Set(L.costs.map((x) => x.month))].sort();
    const own = known(month);
    if (own !== null) return own;
    for (const m of months.filter((x) => x < month).reverse()) { const r = known(m); if (r !== null) return r; }
    for (const m of months.filter((x) => x > month)) { const r = known(m); if (r !== null) return r; }
    return 0;
  };

  const batchCostSoFar = (batchId: number) => {
    let cost = 0;
    for (const m of L.movs) {
      if (m.batchId !== batchId || isBenchMove(m)) continue;
      cost += m.bottlesIn * rateFor(monthOf(m.movedDate));
    }
    return cost;
  };

  /** Growth per multiplication round from the batch's own history (or its parent's), else the crop's default. */
  const batchGrowth = (batchId: number) => {
    const ids = [batchId];
    const b = L.batches.find((x) => x.batchId === batchId);
    if (b?.parentBatchId) ids.push(b.parentBatchId);
    let out = 0;
    let base = 0;
    for (const m of L.movs) {
      if (!ids.includes(m.batchId) || isBenchMove(m)) continue;
      if (h.stageOf(m.toStageId)?.phase !== 'MULTIPLICATION' || m.bottlesOut <= 0) continue;
      out += m.bottlesOut;
      base += m.bottlesIn - m.bottlesLost;
    }
    if (base > 0) return { growth: Math.min(6, Math.max(1, out / base)), fromHistory: true };
    return { growth: L.crops.find((x) => x.cropId === b?.cropId)?.defaultGrowth ?? 2.5, fromHistory: false };
  };

  const groupForecast = (bottles: number, daysIn: number, stage: LabStage, growth: number) => {
    const s = L.settings;
    const all = L.stages;
    const lastM = all.find((x) => x.code === s.lastMultiplicationStage);
    const lastMSeq = lastM?.seqNo ?? Math.max(...all.filter((x) => x.phase === 'MULTIPLICATION').map((x) => x.seqNo));
    // Stages ahead; multiplication stages beyond the usual last one are skipped (the batch goes to rooting).
    const ahead = all.filter((x) => x.seqNo > stage.seqNo && !(x.phase === 'MULTIPLICATION' && x.seqNo > lastMSeq));
    let count = bottles;
    let handled = 0;
    let rounds = 0;
    let days = Math.max(0, avgDays(stage) - daysIn);
    let rooted = PHASE_ORDER[stage.phase] >= PHASE_ORDER.HARDENING;
    for (const next of ahead) {
      handled += count;
      if (next.phase === 'MULTIPLICATION') {
        count *= growth;
        rounds++;
      }
      if (next.phase === 'HARDENING' && !rooted) {
        count *= s.rootingSurvival;
        rooted = true;
      }
      days += avgDays(next);
    }
    return { roundsLeft: rounds, expectedPlants: Math.floor(count * s.hardeningSurvival), readyDate: addDays(today(), Math.ceil(days)), futureHandlings: Math.round(handled) };
  };

  const forecastBatch = (batchId: number) => {
    const b = L.batches.find((x) => x.batchId === batchId);
    if (!b) return null;
    const { growth, fromHistory } = batchGrowth(batchId);
    const active = L.trays.filter((t) => t.batchId === batchId && t.status === 'ACTIVE' && t.bottleCount > 0);
    const groups: ForecastGroup[] = [];
    for (const st of L.stages) {
      const ts = active.filter((t) => t.stageId === st.stageId);
      if (!ts.length) continue;
      const bottles = ts.reduce((n, t) => n + t.bottleCount, 0);
      const daysIn = ts.reduce((n, t) => n + daysBetween(t.placedOn) * t.bottleCount, 0) / bottles;
      groups.push({ batchId, batchCode: b.batchCode, cropId: b.cropId, stageCode: st.code, bottles, ...groupForecast(bottles, daysIn, st, growth) });
    }
    const rate = rateFor(monthOf(today()));
    const costSoFar = batchCostSoFar(batchId);
    const futureCost = groups.reduce((n, g) => n + g.futureHandlings, 0) * rate;
    const expectedPlants = groups.reduce((n, g) => n + g.expectedPlants, 0);
    const expectedCost = costSoFar + futureCost;
    return {
      batchId, batchCode: b.batchCode, cropId: b.cropId,
      liveBottles: groups.reduce((n, g) => n + g.bottles, 0),
      growth, growthFromHistory: fromHistory, groups, expectedPlants,
      readyDate: groups.length ? groups.map((g) => g.readyDate).sort().reverse()[0] : null,
      costSoFar, futureCost, expectedCost,
      costPerPlant: expectedPlants > 0 ? expectedCost / expectedPlants : null,
    };
  };
  type BatchForecast = NonNullable<ReturnType<typeof forecastBatch>>;
  let allMemo: BatchForecast[] | null = null;
  const forecastAll = () => (allMemo ??= L.batches.filter((b) => b.status === 'RUNNING').map((b) => forecastBatch(b.batchId)!).filter(Boolean));

  /** Plants of a crop forecast to be ready by a date, minus plants promised to other open orders due by then. */
  const availability = (cropId: number, byDate: string, excludeOrderId?: number) => {
    const fcs = forecastAll().filter((f) => f.cropId === cropId);
    const groups = fcs.flatMap((f) => f.groups).filter((g) => g.readyDate <= byDate && g.expectedPlants > 0);
    const readyByDate = groups.reduce((n, g) => n + g.expectedPlants, 0);
    let promisedToOthers = 0;
    for (const o of L.orders) {
      if (o.orderId === excludeOrderId || o.cropId !== cropId || o.status !== 'OPEN' || o.decision === 'NO' || o.requiredBy > byDate) continue;
      const sent = L.deliveries.filter((d) => d.orderId === o.orderId).reduce((n, d) => n + d.plantsSent, 0);
      promisedToOthers += Math.max(0, o.plantsPromised - sent);
    }
    let cost = 0;
    let plants = 0;
    for (const g of groups) {
      const f = fcs.find((x) => x.batchId === g.batchId);
      if (f?.costPerPlant !== null && f?.costPerPlant !== undefined) {
        cost += f.costPerPlant * g.expectedPlants;
        plants += g.expectedPlants;
      }
    }
    return { readyByDate, promisedToOthers, available: Math.max(0, readyByDate - promisedToOthers), groups, costPerPlant: plants > 0 ? cost / plants : null };
  };

  return { handlings, monthSummary, knownMonths, rateFor, batchCostSoFar, batchGrowth, forecastBatch, forecastAll, availability };
}
export type Money = ReturnType<typeof money>;
export type Availability = ReturnType<Money['availability']>;

// =====================================================================================================
// Alert checks
// =====================================================================================================
let lastRun = 0;

/**
 * Runs every check and saves new alerts. An alert has a key (what it is about); the same key is never raised
 * twice, so an acknowledged alert does not come back unless something new happens. Runs at most once a minute
 * unless forced. New alerts are also added to L.alerts, so the caller's page shows them straight away.
 */
export async function evaluateAlerts(L: Lab, force = false) {
  if (!force && Date.now() - lastRun < 60_000) return 0;
  lastRun = Date.now();
  const h = helpers(L);
  const rule = (code: string) => L.rules.find((r) => r.code === code);
  const level = (value: number, r: (typeof L.rules)[number]): Severity | null => {
    const past = (limit: number) => (r.direction === 'ABOVE' ? value > limit : value < limit);
    if (r.criticalValue !== null && past(r.criticalValue)) return 'CRITICAL';
    return past(r.warnValue) ? 'WARNING' : null;
  };
  const keys = new Set(L.alerts.map((a) => a.key));
  const fresh: Prisma.AlertCreateManyInput[] = [];
  const raise = (code: string, key: string, severity: Severity, message: string, areaId: number | null, userId: number | null = null) => {
    if (keys.has(key)) return;
    keys.add(key);
    fresh.push({ code, key, severity, message, areaId, userId });
  };
  const benchArea = (benchId: number) => h.benchOf(benchId)?.areaId ?? null;

  // 1. Trays too long in one stage (initiation to rooting) and hardening trays due for a check.
  const hardening = new Set(L.stages.filter((s) => s.phase === 'HARDENING').map((s) => s.stageId));
  for (const [code, inHardening] of [['TRAY_OVERDUE', false], ['HARDENING_CHECK', true]] as const) {
    const r = rule(code);
    if (!r) continue;
    const groups = new Map<string, { batchId: number; stageId: number; areaId: number | null; days: number[]; sev: Severity }>();
    for (const t of L.trays) {
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
        ? `${h.batchCode(g.batchId)}: ${g.days.length} hardening tray${g.days.length > 1 ? 's' : ''} in ${h.stageCode(g.stageId)} for ${Math.max(...g.days)} days. Count surviving plants.`
        : `${h.batchCode(g.batchId)}: ${g.days.length} tray${g.days.length > 1 ? 's' : ''} in ${h.stageCode(g.stageId)} for more than ${g.sev === 'CRITICAL' ? r.criticalValue : r.warnValue} days (oldest ${Math.max(...g.days)} days)`;
      raise(code, `${code}:${k}`, g.sev, msg, g.areaId);
    }
  }

  // 2. Operators below target on the last finished working day.
  const lowOut = rule('LOW_OUTPUT');
  const lastDay = [...new Set(L.asgs.map((a) => a.workDate))].filter((d) => d < today()).sort().pop();
  if (lowOut && lastDay) {
    for (const u of L.users.filter((x) => x.role === 'OPERATOR' && x.status === 'ACTIVE')) {
      const target = L.asgs.filter((a) => a.workDate === lastDay && a.operatorId === u.userId).reduce((n, a) => n + a.targetBottles + a.targetContaminated, 0);
      if (!target) continue;
      const done = L.ents.filter((e) => e.workDate === lastDay && e.operatorId === u.userId && e.status !== 'REJECTED').reduce((n, e) => n + e.bottlesHandled, 0);
      const pct = Math.round((100 * done) / target);
      const sev = level(pct, lowOut);
      if (sev) raise('LOW_OUTPUT', `LOW_OUTPUT:${u.userId}:${lastDay}`, sev, `${u.fullName} did ${done} of ${target} bottles (${pct}%) on ${lastDay}`, u.homeAreaId, u.userId);
    }
  }

  // 3. Contamination loss too high in a zone over the last 7 days.
  const loss = rule('HIGH_LOSS');
  if (loss) {
    const from = addDays(today(), -7);
    const byArea = new Map<number, { handled: number; lost: number }>();
    for (const e of L.ents) {
      if (e.workDate < from || e.status === 'REJECTED' || e.kind !== 'SUBCULTURE') continue;
      const a = h.entryArea(e);
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
      if (sev) raise('HIGH_LOSS', `HIGH_LOSS:${areaId}:${week}:${sev}`, sev, `${h.areaOf(areaId)?.name ?? 'Zone'}: ${pct}% of bottles lost in the last 7 days (${x.lost} of ${x.handled})`, areaId);
    }
  }

  // 4. Stock at or below its reorder level.
  const low = rule('LOW_STOCK');
  const mediaArea = L.areas.find((a) => a.areaType === 'MEDIA')?.areaId ?? null;
  if (low) {
    for (const i of L.items) {
      if (i.reorderLevel <= 0) continue;
      const pct = (100 * i.stockQty) / i.reorderLevel;
      const sev = pct <= (low.criticalValue ?? -1) ? 'CRITICAL' : pct <= low.warnValue ? 'WARNING' : null;
      if (!sev) continue;
      const lastIn = L.txns.filter((t) => t.itemId === i.itemId && t.txnType === 'IN').reduce((m, t) => Math.max(m, t.txnId), 0);
      raise('LOW_STOCK', `LOW_STOCK:${i.itemId}:${sev}:${lastIn}`, sev, `${i.name}: ${i.stockQty} ${i.unit} left (reorder at ${i.reorderLevel} ${i.unit})`, mediaArea);
    }
  }

  // 5. Growth room out of range: the last 5 readings all past the limit; and a node that stopped sending.
  for (const dev of L.devices) {
    const src = await readingSource(dev.deviceId, dev.intervalMin);
    const now = Date.now();
    const last5 = (await src.between(now - 25 * 60_000, now, dev.intervalMin)).slice(-5);
    const zone = h.areaOf(dev.areaId)?.name ?? 'Room';
    const checks: [string, (r: (typeof last5)[number]) => number, string][] = [
      ['ROOM_TEMP_HIGH', (r) => r.tempC, '°C'], ['ROOM_TEMP_LOW', (r) => r.tempC, '°C'], ['HUMIDITY_HIGH', (r) => r.humidityPct, '%'],
    ];
    for (const [code, get, unit] of checks) {
      const r = rule(code);
      if (!r || last5.length < 5) continue;
      const sevs = last5.map((x) => level(get(x), r));
      if (sevs.some((s) => !s)) continue;
      const sev: Severity = sevs.every((s) => s === 'CRITICAL') ? 'CRITICAL' : 'WARNING';
      raise(code, `${code}:${today()}:${sev}`, sev, `${zone} at ${get(last5[4])} ${unit} for the last 5 readings`, dev.areaId);
    }
    const off = rule('DEVICE_OFFLINE');
    const latest = await src.latest();
    if (off && latest) {
      const ageMin = (now - new Date(latest.recordedAt).getTime()) / 60_000;
      const sev = level(ageMin, off);
      if (sev) raise('DEVICE_OFFLINE', `DEVICE_OFFLINE:${dev.deviceId}:${today()}`, sev, `${dev.name} has not sent data for ${Math.round(ageMin)} minutes`, dev.areaId);
    }
  }

  if (!fresh.length) return 0;
  await prisma.alert.createMany({ data: fresh, skipDuplicates: true });
  // Show the new alerts on this page straight away.
  const saved = await prisma.alert.findMany({ where: { key: { in: fresh.map((f) => f.key!) } } });
  for (const a of saved) L.alerts.push({ ...a, createdAt: a.createdAt.toISOString(), createdDate: labDate(a.createdAt), ackAt: a.ackAt?.toISOString() ?? null });
  return saved.length;
}
