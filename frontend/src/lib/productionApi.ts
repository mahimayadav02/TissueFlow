// FAKE API, production part: batches, samples, trays, stage moves and losses.
// Scope rule: manager sees everything; a supervisor sees trays on benches in
// their own zones; an operator sees trays in their own zone.
import { ApiError, copy, daysBetween, need, today, wait } from './apiUtil';
import { db, nextId, save } from './store';
import type { Batch, Contamination, LossCause, LossType, Sample, Stage, Tray, TrayMovement, User } from './types';

const TRAY_MAX = 30;

// ---------- lookups ----------
const stageOf = (id: number) => db.stages.find((s) => s.stageId === id);
const benchOf = (id: number) => db.benches.find((b) => b.benchId === id);
const areaOfBench = (benchId: number) => benchOf(benchId)?.areaId ?? null;
const cropName = (cropId: number) => {
  const c = db.crops.find((x) => x.cropId === cropId);
  return c ? `${c.name} ${c.variety}` : '—';
};

/** Zones (area ids) the user may see, or null for all zones. */
export function visibleAreas(user: User): number[] | null {
  if (user.role === 'MANAGER') return null;
  if (user.role === 'SUPERVISOR') return user.zoneIds;
  return user.homeAreaId ? [user.homeAreaId] : [];
}
/** Batches an operator has been given work on today. They may open those trays even if the trays sit in another zone. */
export function assignedBatchIds(user: User): Set<number> {
  const d = today();
  return new Set(db.assignments.filter((a) => a.operatorId === user.userId && a.workDate === d).map((a) => a.batchId));
}
const canSeeTray = (user: User, t: Tray) => {
  const areas = visibleAreas(user);
  const a = areaOfBench(t.benchId);
  if (areas === null || (a !== null && areas.includes(a))) return true;
  return user.role === 'OPERATOR' && assignedBatchIds(user).has(t.batchId);
};
const overdueRule = () => db.alertRules.find((r) => r.code === 'TRAY_OVERDUE');

export type Overdue = 'OK' | 'WARNING' | 'CRITICAL';
function overdueLevel(daysInStage: number): Overdue {
  const r = overdueRule();
  if (!r) return 'OK';
  if (r.criticalValue !== null && daysInStage > r.criticalValue) return 'CRITICAL';
  return daysInStage > r.warnValue ? 'WARNING' : 'OK';
}

// ---------- shapes returned to pages ----------
export interface TrayRow extends Tray {
  batchCode: string;
  stageCode: string;
  benchCode: string;
  areaId: number | null;
  areaName: string;
  daysInStage: number;
  overdue: Overdue;
}

export interface BatchSummary extends Batch {
  cropName: string;
  parentCode: string | null;
  activeTrays: number;
  liveBottles: number;
  /** Bottles in each stage, in stage order. */
  byStage: { stageCode: string; bottles: number; trays: number }[];
  mainStage: string;
  lostBottles: number;
  ageDays: number;
  overdueTrays: number;
}

export interface LossRow extends Contamination {
  qrCode: string;
  batchCode: string;
  stageCode: string;
  areaName: string;
  reportedByName: string;
}

export interface BatchDetail {
  batch: BatchSummary;
  samples: Sample[];
  trays: TrayRow[];
  history: (TrayMovement & { fromCode: string; toCode: string })[];
  losses: LossRow[];
  children: { batchId: number; batchCode: string }[];
}

function trayRow(t: Tray): TrayRow {
  const st = stageOf(t.stageId);
  const bench = benchOf(t.benchId);
  const area = db.areas.find((a) => a.areaId === bench?.areaId);
  const days = daysBetween(t.placedOn);
  return {
    ...copy(t),
    batchCode: db.batches.find((b) => b.batchId === t.batchId)?.batchCode ?? '—',
    stageCode: st?.code ?? '—',
    benchCode: bench?.code ?? '—',
    areaId: area?.areaId ?? null,
    areaName: area?.name ?? '—',
    daysInStage: days,
    overdue: overdueLevel(days),
  };
}

function lossRow(c: Contamination): LossRow {
  const t = db.trays.find((x) => x.trayId === c.trayId);
  const r = t ? trayRow(t) : null;
  return {
    ...copy(c),
    qrCode: r?.qrCode ?? '—',
    batchCode: r?.batchCode ?? '—',
    stageCode: r?.stageCode ?? '—',
    areaName: r?.areaName ?? '—',
    reportedByName: db.users.find((u) => u.userId === c.reportedBy)?.fullName ?? '—',
  };
}

function summary(b: Batch, trays: Tray[]): BatchSummary {
  const active = trays.filter((t) => t.batchId === b.batchId && t.status === 'ACTIVE');
  const stages = [...db.stages].sort((x, y) => x.seqNo - y.seqNo);
  const byStage = stages
    .map((s) => {
      const ts = active.filter((t) => t.stageId === s.stageId);
      return { stageCode: s.code, bottles: ts.reduce((n, t) => n + t.bottleCount, 0), trays: ts.length };
    })
    .filter((x) => x.trays > 0);
  const main = [...byStage].sort((x, y) => y.bottles - x.bottles)[0];
  const trayIds = new Set(db.trays.filter((t) => t.batchId === b.batchId).map((t) => t.trayId));
  return {
    ...copy(b),
    cropName: cropName(b.cropId),
    parentCode: b.parentBatchId ? db.batches.find((x) => x.batchId === b.parentBatchId)?.batchCode ?? null : null,
    activeTrays: active.length,
    liveBottles: active.reduce((n, t) => n + t.bottleCount, 0),
    byStage,
    mainStage: main?.stageCode ?? '—',
    lostBottles: db.contaminations.filter((c) => trayIds.has(c.trayId)).reduce((n, c) => n + c.bottlesLost, 0),
    ageDays: daysBetween(b.startDate),
    overdueTrays: active.filter((t) => overdueLevel(daysBetween(t.placedOn)) !== 'OK').length,
  };
}

/** Splits a number of bottles into trays of up to 30. */
function makeTrays(batch: Batch, stageId: number, benchId: number, bottles: number, mediaLotId: number | null): Tray[] {
  const made: Tray[] = [];
  let seq = db.trays.filter((t) => t.batchId === batch.batchId).length;
  let left = bottles;
  while (left > 0) {
    const n = Math.min(TRAY_MAX, left);
    seq += 1;
    const tray: Tray = {
      trayId: nextId(db.trays, 'trayId'), qrCode: `${batch.batchCode}-${String(seq).padStart(4, '0')}`, batchId: batch.batchId,
      stageId, benchId, mediaLotId, bottleCount: n, startBottles: n, placedOn: today(), status: 'ACTIVE',
    };
    db.trays.push(tray);
    made.push(tray);
    left -= n;
  }
  return made;
}

function addMovement(m: Omit<TrayMovement, 'movementId' | 'movedAt'>): number {
  const movementId = nextId(db.movements, 'movementId');
  db.movements.push({ ...m, movementId, movedAt: new Date().toISOString() });
  return movementId;
}

export interface NewBatchInput {
  cropId: number;
  startDate: string;
  samples: Omit<Sample, 'sampleId' | 'batchId'>[];
  /** Bottles inoculated on day one (each explant in its own bottle). */
  bottles: number;
  benchId: number;
}

export interface SubcultureInput {
  trayId: number;
  /** Media lot the new bottles were filled from (optional). */
  mediaLotId?: number | null;
  toStageId: number;
  toBenchId: number;
  bottlesOut: number;
  bottlesLost: number;
  cause?: LossCause;
  contType?: LossType;
}

export interface LossInput {
  trayId: number;
  bottlesLost: number;
  cause: LossCause;
  contType: LossType;
  foundOn: string;
  note: string;
}

export const productionApi = {
  async listBatches(user: User, includeClosed = false): Promise<BatchSummary[]> {
    await wait();
    const visible = db.trays.filter((t) => canSeeTray(user, t));
    const ids = new Set(visible.map((t) => t.batchId));
    return db.batches
      .filter((b) => (includeClosed || b.status === 'RUNNING') && (user.role === 'MANAGER' || ids.has(b.batchId)))
      .map((b) => summary(b, user.role === 'MANAGER' ? db.trays : visible))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  },

  async getBatch(batchId: number, user: User): Promise<BatchDetail> {
    await wait();
    const b = db.batches.find((x) => x.batchId === batchId);
    need(b, 'Batch not found.');
    const trays = db.trays.filter((t) => t.batchId === batchId && canSeeTray(user, t));
    need(user.role === 'MANAGER' || trays.length > 0, 'This batch has no trays in your zones.');
    const all = db.trays.filter((t) => t.batchId === batchId);
    const code = (id: number) => stageOf(id)?.code ?? '—';
    const trayIds = new Set(all.map((t) => t.trayId));
    return {
      batch: summary(b!, user.role === 'MANAGER' ? db.trays : trays),
      samples: copy(db.samples.filter((s) => s.batchId === batchId)),
      trays: trays.filter((t) => t.status === 'ACTIVE').map(trayRow).sort((x, y) => x.qrCode.localeCompare(y.qrCode)),
      history: db.movements
        .filter((m) => m.batchId === batchId && m.fromBenchId === 0)
        .concat(aggregateMoves(batchId))
        .map((m) => ({ ...copy(m), fromCode: code(m.fromStageId), toCode: code(m.toStageId) }))
        .sort((x, y) => x.movedAt.localeCompare(y.movedAt)),
      losses: db.contaminations.filter((c) => trayIds.has(c.trayId)).map(lossRow).sort((x, y) => y.foundOn.localeCompare(x.foundOn)),
      children: db.batches.filter((x) => x.parentBatchId === batchId).map((x) => ({ batchId: x.batchId, batchCode: x.batchCode })),
    };
  },

  async createBatch(input: NewBatchInput): Promise<Batch> {
    await wait();
    need(db.crops.some((c) => c.cropId === input.cropId), 'Choose a crop.');
    need(input.startDate, 'Choose the start date.');
    need(input.samples.length > 0, 'Add at least one sample.');
    for (const s of input.samples) {
      need(s.sampleType.trim(), 'Every sample needs a type.');
      need(s.noOfSamples > 0 && s.sampleSize > 0, 'Number of samples and sample size must be more than 0.');
    }
    need(input.bottles > 0, 'Bottles inoculated must be more than 0.');
    need(benchOf(input.benchId), 'Choose a bench.');
    const d = new Date(input.startDate);
    const base = `B${d.getMonth() + 1}-${String(d.getFullYear()).slice(2)}`;
    let code = base;
    for (let i = 0; db.batches.some((b) => b.batchCode === code); i++) code = base + String.fromCharCode(66 + i); // B, C, …
    const first = [...db.stages].sort((a, b) => a.seqNo - b.seqNo)[0];
    need(first, 'Add stages in Set-up first.');
    const batch: Batch = { batchId: nextId(db.batches, 'batchId'), batchCode: code, cropId: input.cropId, parentBatchId: null, startDate: input.startDate, status: 'RUNNING' };
    db.batches.push(batch);
    for (const s of input.samples) db.samples.push({ ...s, sampleId: nextId(db.samples, 'sampleId'), batchId: batch.batchId });
    makeTrays(batch, first.stageId, input.benchId, input.bottles, null);
    save();
    return copy(batch);
  },

  /** Moves the chosen trays into a new child batch (e.g. part goes to rooting while the rest multiplies). */
  async splitBatch(batchId: number, trayIds: number[]): Promise<Batch> {
    await wait();
    const parent = db.batches.find((b) => b.batchId === batchId);
    need(parent, 'Batch not found.');
    const active = db.trays.filter((t) => t.batchId === batchId && t.status === 'ACTIVE');
    need(trayIds.length > 0, 'Choose the trays that go into the new part.');
    need(trayIds.length < active.length, 'Leave at least one tray in the original batch.');
    let letter = 65; // A
    while (db.batches.some((b) => b.batchCode === parent!.batchCode + String.fromCharCode(letter))) letter++;
    const child: Batch = {
      batchId: nextId(db.batches, 'batchId'), batchCode: parent!.batchCode + String.fromCharCode(letter), cropId: parent!.cropId,
      parentBatchId: batchId, startDate: today(), status: 'RUNNING',
    };
    db.batches.push(child);
    for (const t of db.trays) if (trayIds.includes(t.trayId) && t.batchId === batchId) t.batchId = child.batchId;
    save();
    return copy(child);
  },

  async closeBatch(batchId: number): Promise<void> {
    await wait();
    const b = db.batches.find((x) => x.batchId === batchId);
    need(b, 'Batch not found.');
    need(!db.trays.some((t) => t.batchId === batchId && t.status === 'ACTIVE'), 'The batch still has active trays.');
    b!.status = 'CLOSED';
    save();
  },

  async listTrays(user: User): Promise<TrayRow[]> {
    await wait();
    return db.trays.filter((t) => t.status === 'ACTIVE' && canSeeTray(user, t)).map(trayRow).sort((a, b) => a.qrCode.localeCompare(b.qrCode));
  },

  async getTrayByQr(qr: string, user: User): Promise<TrayRow> {
    await wait();
    const t = db.trays.find((x) => x.qrCode.toLowerCase() === qr.trim().toLowerCase());
    need(t, `No tray with code ${qr.trim()}.`);
    need(t!.status === 'ACTIVE', `Tray ${t!.qrCode} is no longer active (${t!.status === 'MOVED' ? 'sub-cultured into new trays' : t!.status === 'SENT' ? 'all plants sent' : 'all bottles lost'}).`);
    need(canSeeTray(user, t!), 'This tray is not in your zones.');
    return trayRow(t!);
  },

  async getTraysByIds(ids: number[]): Promise<TrayRow[]> {
    await wait(50);
    return db.trays.filter((t) => ids.includes(t.trayId)).map(trayRow);
  },

  /** Sub-culture: the tray's bottles are cut and placed on fresh medium, giving new trays at the next (or same) stage. */
  async subcultureTray(input: SubcultureInput, user: User): Promise<Tray[]> {
    await wait();
    const t = db.trays.find((x) => x.trayId === input.trayId);
    need(t && t.status === 'ACTIVE', 'Tray not found or not active.');
    need(canSeeTray(user, t!), 'This tray is not in your zones.');
    const from = stageOf(t!.stageId)!;
    const to = stageOf(input.toStageId);
    need(to, 'Choose the stage the new bottles go to.');
    need(to!.seqNo >= from.seqNo, 'Bottles cannot go back to an earlier stage.');
    need(benchOf(input.toBenchId), 'Choose a bench for the new trays.');
    need(input.bottlesLost >= 0 && input.bottlesLost <= t!.bottleCount, `Lost bottles must be between 0 and ${t!.bottleCount}.`);
    need(input.bottlesOut >= 0, 'New bottles cannot be negative.');
    need(input.bottlesOut > 0 || input.bottlesLost === t!.bottleCount, 'Enter the new bottles made, or mark all bottles as lost.');
    need(Number.isInteger(input.bottlesOut) && Number.isInteger(input.bottlesLost), 'Bottle counts must be whole numbers.');
    // Same upper limit the forecast uses for growth: more than 6 new bottles from one bottle is almost surely a typing mistake.
    const maxOut = (t!.bottleCount - input.bottlesLost) * 6;
    need(input.bottlesOut <= maxOut, `${input.bottlesOut} new bottles from ${t!.bottleCount - input.bottlesLost} good bottles is more than 6 times. Check the count (at most ${maxOut}).`);
    if (input.bottlesLost > 0) need(input.cause && input.contType, 'Choose the cause and type of the loss.');
    const batch = db.batches.find((b) => b.batchId === t!.batchId)!;
    if (input.mediaLotId) {
      const lot = db.mediaLots.find((l) => l.mediaLotId === input.mediaLotId);
      need(lot, 'Media lot not found.');
      const recipe = db.recipes.find((r) => r.recipeId === lot!.recipeId);
      need(recipe?.phase === to!.phase, `Lot ${lot!.lotCode} is ${recipe?.code ?? ''} medium, not for ${to!.code}.`);
      need(today() <= lot!.expiresOn, `Lot ${lot!.lotCode} expired on ${lot!.expiresOn}.`);
      const used = db.trays.filter((t) => t.mediaLotId === lot!.mediaLotId).reduce((n, t) => n + (t.startBottles ?? t.bottleCount), 0);
      need(used + input.bottlesOut <= lot!.bottlesFilled, `Lot ${lot!.lotCode} has only ${Math.max(0, lot!.bottlesFilled - used)} bottles left.`);
    }
    const made = makeTrays(batch, to!.stageId, input.toBenchId, input.bottlesOut, input.mediaLotId ?? null);
    let contId: number | null = null;
    if (input.bottlesLost > 0) {
      contId = nextId(db.contaminations, 'contId');
      db.contaminations.push({
        contId, trayId: t!.trayId, bottlesLost: input.bottlesLost, cause: input.cause!,
        contType: input.contType!, foundOn: today(), reportedBy: user.userId, note: 'Found at sub-culture',
      });
    }
    const movementId = addMovement({
      batchId: t!.batchId, trayId: t!.trayId, newTrayIds: made.map((m) => m.trayId), fromStageId: t!.stageId, toStageId: to!.stageId,
      fromBenchId: t!.benchId, toBenchId: input.toBenchId, bottlesIn: t!.bottleCount, bottlesOut: input.bottlesOut, bottlesLost: input.bottlesLost, movedBy: user.userId,
    });
    // An operator's sub-culture becomes a work entry for the supervisor to check.
    if (user.role === 'OPERATOR') {
      const d = today();
      const assign = db.assignments.find((a) => a.operatorId === user.userId && a.workDate === d && a.batchId === t!.batchId && a.stageId === t!.stageId);
      db.entries.push({
        entryId: nextId(db.entries, 'entryId'), assignId: assign?.assignId ?? null, operatorId: user.userId, trayId: t!.trayId, movementId, contId,
        workDate: d, bottlesHandled: t!.bottleCount, bottlesProduced: input.bottlesOut, bottlesLost: input.bottlesLost, status: 'PENDING',
        enteredAt: new Date().toISOString(), verifiedBy: null, verifiedAt: null, note: '',
      });
    }
    t!.status = made.length ? 'MOVED' : 'LOST';
    save();
    return copy(made);
  },

  /** Moves trays to another bench without changing their stage. */
  async moveTrays(trayIds: number[], toBenchId: number, user: User): Promise<void> {
    await wait();
    need(trayIds.length > 0, 'Choose at least one tray.');
    const bench = benchOf(toBenchId);
    need(bench, 'Choose a bench.');
    const areas = visibleAreas(user);
    need(areas === null || areas.includes(bench!.areaId), 'You can only move trays to benches in your zones.');
    for (const t of db.trays) {
      if (!trayIds.includes(t.trayId)) continue;
      need(canSeeTray(user, t), `Tray ${t.qrCode} is not in your zones.`);
      if (t.benchId === toBenchId) continue;
      addMovement({
        batchId: t.batchId, trayId: t.trayId, newTrayIds: [t.trayId], fromStageId: t.stageId, toStageId: t.stageId,
        fromBenchId: t.benchId, toBenchId, bottlesIn: t.bottleCount, bottlesOut: t.bottleCount, bottlesLost: 0, movedBy: user.userId,
      });
      t.benchId = toBenchId;
    }
    save();
  },

  /** Trays currently on each bench, to warn when a bench is full. */
  async benchLoad(): Promise<Record<number, number>> {
    await wait(50);
    const load: Record<number, number> = {};
    for (const t of db.trays) if (t.status === 'ACTIVE') load[t.benchId] = (load[t.benchId] ?? 0) + 1;
    return load;
  },

  async recordLoss(input: LossInput, user: User): Promise<void> {
    await wait();
    const t = db.trays.find((x) => x.trayId === input.trayId);
    need(t && t.status === 'ACTIVE', 'Tray not found or not active.');
    need(canSeeTray(user, t!), 'This tray is not in your zones.');
    need(input.bottlesLost > 0 && input.bottlesLost <= t!.bottleCount, `Lost bottles must be between 1 and ${t!.bottleCount}.`);
    need(input.foundOn && input.foundOn <= today(), 'The date cannot be in the future.');
    db.contaminations.push({ ...input, note: input.note.trim(), contId: nextId(db.contaminations, 'contId'), reportedBy: user.userId });
    t!.bottleCount -= input.bottlesLost;
    if (t!.bottleCount === 0) t!.status = 'LOST';
    save();
  },

  async listLosses(user: User): Promise<LossRow[]> {
    await wait();
    const areas = visibleAreas(user);
    return db.contaminations
      .map(lossRow)
      .filter((r) => {
        if (areas === null) return true;
        const t = db.trays.find((x) => x.trayId === r.trayId);
        const a = t ? areaOfBench(t.benchId) : null;
        return a !== null && areas.includes(a);
      })
      .sort((a, b) => b.foundOn.localeCompare(a.foundOn));
  },

  /** Bottles handled per stage (from stage history), used for loss %. */
  async handledByStage(): Promise<Record<string, number>> {
    await wait(50);
    const out: Record<string, number> = {};
    for (const m of db.movements) {
      const code = stageOf(m.fromStageId)?.code;
      if (code) out[code] = (out[code] ?? 0) + m.bottlesIn;
    }
    for (const t of db.trays) {
      if (t.status !== 'ACTIVE') continue;
      const code = stageOf(t.stageId)?.code;
      if (code) out[code] = (out[code] ?? 0) + t.bottleCount;
    }
    return out;
  },
};

/** Groups today's tray-level sub-cultures into one history line per stage change and day. */
function aggregateMoves(batchId: number): TrayMovement[] {
  const groups = new Map<string, TrayMovement>();
  for (const m of db.movements) {
    if (m.batchId !== batchId || m.fromBenchId === 0 || m.fromStageId === m.toStageId && m.bottlesOut === m.bottlesIn) continue;
    const key = `${m.fromStageId}-${m.toStageId}-${m.movedAt.slice(0, 10)}`;
    const g = groups.get(key);
    if (g) {
      g.bottlesIn += m.bottlesIn;
      g.bottlesOut += m.bottlesOut;
      g.bottlesLost += m.bottlesLost;
    } else groups.set(key, { ...m, newTrayIds: [] });
  }
  return [...groups.values()];
}

export type { Stage };
export { ApiError };
