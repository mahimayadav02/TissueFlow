// Forecast and cost calculations, following the formulas in the system design:
//   cost per bottle-round = lab costs of the month ÷ bottles handled that month
//   batch cost so far     = Σ (bottles of the batch handled in a month × that month's cost per bottle-round)
//   expected plants       = bottles now × growth ^ rounds left × rooting survival × hardening survival
//   expected cost         = cost so far + remaining bottle-rounds × cost per bottle-round
// Nothing here is stored; it is worked out from the records each time.
import { addDays, daysBetween, today } from './apiUtil';
import { db } from './store';
import type { CostHeading, Phase, Stage } from './types';

const PHASE_ORDER: Record<Phase, number> = { INITIATION: 0, MULTIPLICATION: 1, ROOTING: 2, HARDENING: 3 };
export const avgDays = (s: Stage) => (s.minDays + s.maxDays) / 2;
const stagesSorted = () => [...db.stages].sort((a, b) => a.seqNo - b.seqNo);
const stageOf = (id: number) => db.stages.find((s) => s.stageId === id);
const monthOf = (iso: string) => iso.slice(0, 7);

// ---------- bottles handled ----------
/** A bench-only move (same stage, nothing gained or lost) is not a sub-culture, so it is not counted as handling. */
const isBenchMove = (m: { fromStageId: number; toStageId: number; bottlesIn: number; bottlesOut: number; bottlesLost: number }) =>
  m.fromStageId === m.toStageId && m.bottlesIn === m.bottlesOut && m.bottlesLost === 0;

/** Every sub-culture in the lab: operator entries, plus stage moves done by supervisors (which have no entry). */
export function handlings(): { date: string; batchId: number; bottles: number }[] {
  const linked = new Set(db.entries.filter((e) => e.movementId !== null).map((e) => e.movementId));
  const out: { date: string; batchId: number; bottles: number }[] = [];
  for (const e of db.entries) {
    if (e.status === 'REJECTED') continue;
    const t = db.trays.find((x) => x.trayId === e.trayId);
    if (t) out.push({ date: e.workDate, batchId: t.batchId, bottles: e.bottlesHandled });
  }
  for (const m of db.movements) {
    if (linked.has(m.movementId) || isBenchMove(m)) continue;
    out.push({ date: m.movedAt.slice(0, 10), batchId: m.batchId, bottles: m.bottlesIn });
  }
  return out;
}

// ---------- money per month ----------
export interface MonthSummary {
  month: string;
  byHeading: Partial<Record<CostHeading, number>>;
  totalCost: number;
  bottlesHandled: number;
  /** null when no costs or no bottles were entered for the month. */
  costPerBottle: number | null;
  plantsSent: number;
  revenue: number;
  profit: number;
}

export function monthSummary(month: string): MonthSummary {
  const byHeading: Partial<Record<CostHeading, number>> = {};
  for (const c of db.costs) if (c.month === month) byHeading[c.heading] = (byHeading[c.heading] ?? 0) + c.amount;
  const totalCost = Object.values(byHeading).reduce((n, x) => n + (x ?? 0), 0);
  const bottlesHandled = handlings().filter((h) => monthOf(h.date) === month).reduce((n, h) => n + h.bottles, 0);
  let plantsSent = 0;
  let revenue = 0;
  for (const d of db.deliveries) {
    if (monthOf(d.sentOn) !== month) continue;
    const o = db.orders.find((x) => x.orderId === d.orderId);
    plantsSent += d.plantsSent;
    revenue += d.plantsSent * (o?.ratePerPlant ?? 0);
  }
  return {
    month, byHeading, totalCost, bottlesHandled,
    costPerBottle: totalCost > 0 && bottlesHandled > 0 ? totalCost / bottlesHandled : null,
    plantsSent, revenue, profit: revenue - totalCost,
  };
}

/** Months that have costs, handling or deliveries, newest first. */
export function knownMonths(): string[] {
  const set = new Set<string>([monthOf(today())]);
  for (const c of db.costs) set.add(c.month);
  for (const h of handlings()) set.add(monthOf(h.date));
  for (const d of db.deliveries) set.add(monthOf(d.sentOn));
  return [...set].sort().reverse();
}

/** Cost per bottle-round to use for a month: its own if known, else the nearest earlier month's, else the nearest later month's. */
export function rateFor(month: string, cache?: Map<string, number | null>): number {
  const known = (m: string) => {
    if (cache?.has(m)) return cache.get(m)!;
    const r = monthSummary(m).costPerBottle;
    cache?.set(m, r);
    return r;
  };
  const months = [...new Set(db.costs.map((c) => c.month))].sort();
  const own = known(month);
  if (own !== null) return own;
  const earlier = months.filter((m) => m < month).reverse();
  for (const m of earlier) { const r = known(m); if (r !== null) return r; }
  for (const m of months.filter((x) => x > month)) { const r = known(m); if (r !== null) return r; }
  return 0;
}

/** Σ (bottles of the batch sub-cultured in a month × that month's cost per bottle-round). */
export function batchCostSoFar(batchId: number, cache = new Map<string, number | null>()): number {
  let cost = 0;
  for (const m of db.movements) {
    if (m.batchId !== batchId || isBenchMove(m)) continue;
    cost += m.bottlesIn * rateFor(monthOf(m.movedAt), cache);
  }
  return cost;
}

// ---------- growth and forecast ----------
/** Growth per multiplication round from the batch's own history (or its parent's), else the crop's default. */
export function batchGrowth(batchId: number): { growth: number; fromHistory: boolean } {
  const ids = [batchId];
  const b = db.batches.find((x) => x.batchId === batchId);
  if (b?.parentBatchId) ids.push(b.parentBatchId);
  let out = 0;
  let base = 0;
  for (const m of db.movements) {
    if (!ids.includes(m.batchId) || isBenchMove(m)) continue;
    const to = stageOf(m.toStageId);
    if (to?.phase !== 'MULTIPLICATION' || m.bottlesOut <= 0) continue;
    out += m.bottlesOut;
    base += m.bottlesIn - m.bottlesLost;
  }
  if (base > 0) return { growth: Math.min(6, Math.max(1, out / base)), fromHistory: true };
  const crop = db.crops.find((c) => c.cropId === b?.cropId);
  return { growth: crop?.defaultGrowth ?? 2.5, fromHistory: false };
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
  /** Bottle-rounds still to be done before these plants leave the lab. */
  futureHandlings: number;
}

export interface BatchForecast {
  batchId: number;
  batchCode: string;
  cropId: number;
  liveBottles: number;
  growth: number;
  growthFromHistory: boolean;
  groups: ForecastGroup[];
  expectedPlants: number;
  /** When the last of the batch is ready. */
  readyDate: string | null;
  costSoFar: number;
  futureCost: number;
  expectedCost: number;
  costPerPlant: number | null;
}

/** Works out one stage group of a batch: where it goes next, how many plants it gives, and when. */
function groupForecast(bottles: number, daysIn: number, stage: Stage, growth: number): Omit<ForecastGroup, 'batchId' | 'batchCode' | 'cropId' | 'stageCode' | 'bottles'> {
  const s = db.settings;
  const all = stagesSorted();
  const lastM = all.find((x) => x.code === s.lastMultiplicationStage);
  const lastMSeq = lastM?.seqNo ?? Math.max(...all.filter((x) => x.phase === 'MULTIPLICATION').map((x) => x.seqNo));
  // Stages still ahead: multiplication stages beyond the usual last one are skipped (the batch goes to rooting).
  const ahead = all.filter((x) => x.seqNo > stage.seqNo && !(x.phase === 'MULTIPLICATION' && x.seqNo > lastMSeq));
  let count = bottles;
  let handled = 0;
  let rounds = 0;
  let days = Math.max(0, avgDays(stage) - daysIn);
  let rooted = PHASE_ORDER[stage.phase] >= PHASE_ORDER.HARDENING;
  for (const next of ahead) {
    handled += count; // every bottle is handled once to leave the stage it is in
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
  return {
    roundsLeft: rounds,
    expectedPlants: Math.floor(count * s.hardeningSurvival),
    readyDate: addDays(today(), Math.ceil(days)),
    futureHandlings: Math.round(handled),
  };
}

export function forecastBatch(batchId: number, cache = new Map<string, number | null>()): BatchForecast | null {
  const b = db.batches.find((x) => x.batchId === batchId);
  if (!b) return null;
  const { growth, fromHistory } = batchGrowth(batchId);
  const active = db.trays.filter((t) => t.batchId === batchId && t.status === 'ACTIVE' && t.bottleCount > 0);
  const groups: ForecastGroup[] = [];
  for (const st of stagesSorted()) {
    const ts = active.filter((t) => t.stageId === st.stageId);
    if (!ts.length) continue;
    const bottles = ts.reduce((n, t) => n + t.bottleCount, 0);
    const daysIn = ts.reduce((n, t) => n + daysBetween(t.placedOn) * t.bottleCount, 0) / bottles;
    groups.push({ batchId, batchCode: b.batchCode, cropId: b.cropId, stageCode: st.code, bottles, ...groupForecast(bottles, daysIn, st, growth) });
  }
  const rate = rateFor(monthOf(today()), cache);
  const costSoFar = batchCostSoFar(batchId, cache);
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
}

export function forecastAll(): BatchForecast[] {
  const cache = new Map<string, number | null>();
  return db.batches.filter((b) => b.status === 'RUNNING').map((b) => forecastBatch(b.batchId, cache)!).filter(Boolean);
}

// ---------- can we deliver by this date? ----------
export interface Availability {
  /** Plants forecast to be ready by the date, crop-wise. */
  readyByDate: number;
  /** Plants already promised to other open orders due by the same date (minus what was sent). */
  promisedToOthers: number;
  available: number;
  groups: ForecastGroup[];
  /** Weighted expected cost per plant of the batches that would supply the order. */
  costPerPlant: number | null;
}

export function availability(cropId: number, byDate: string, excludeOrderId?: number): Availability {
  const fcs = forecastAll().filter((f) => f.cropId === cropId);
  const groups = fcs.flatMap((f) => f.groups).filter((g) => g.readyDate <= byDate && g.expectedPlants > 0);
  const readyByDate = groups.reduce((n, g) => n + g.expectedPlants, 0);
  let promisedToOthers = 0;
  for (const o of db.orders) {
    if (o.orderId === excludeOrderId || o.cropId !== cropId || o.status !== 'OPEN' || o.decision === 'NO' || o.requiredBy > byDate) continue;
    const sent = db.deliveries.filter((d) => d.orderId === o.orderId).reduce((n, d) => n + d.plantsSent, 0);
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
  return {
    readyByDate, promisedToOthers,
    available: Math.max(0, readyByDate - promisedToOthers),
    groups, costPerPlant: plants > 0 ? cost / plants : null,
  };
}
