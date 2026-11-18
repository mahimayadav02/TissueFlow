// Rules shared by every part of the fake API about the kinds of daily work.
// Sub-culture, washing, media making and the two quality checks all count as "bottles handled",
// so one day's output can be added up across the whole lab and then split by operator, zone, stage or batch.
import { today } from './apiUtil';
import { db } from './store';
import type { AreaType, ProductionEntry, User, WorkAssignment, WorkKind } from './types';

/** Older records have no kind: they are sub-culture work. */
export const kindOf = (x: { kind?: WorkKind }): WorkKind => x.kind ?? 'SUBCULTURE';

/** The kinds of work that are done in each kind of zone. */
export const KINDS_FOR_ZONE: Partial<Record<AreaType, WorkKind[]>> = {
  WASH: ['WASH'],
  MEDIA: ['MEDIA'],
  INOCULATION: ['SUBCULTURE'],
  INCUBATION: ['SUBCULTURE'],
  QC: ['QC_CULTURE', 'QC_MEDIA'],
};
export const kindsForArea = (areaId: number | null | undefined): WorkKind[] => {
  const t = db.areas.find((a) => a.areaId === areaId)?.areaType;
  return (t && KINDS_FOR_ZONE[t]) || ['SUBCULTURE'];
};

/** Total target of one line: washing counts plain and contaminated bottles together. */
export const targetOf = (a: WorkAssignment) => a.targetBottles + (a.targetContaminated ?? 0);

/** Every zone an operator works in: the home zone first, then any other zones. */
export function workZones(u: User): number[] {
  const z = u.homeAreaId !== null ? [u.homeAreaId] : [];
  for (const id of u.zoneIds ?? []) if (!z.includes(id)) z.push(id);
  return z;
}

/** Most operators that may work at one laminar-flow hood on the same day (domain expert). */
export const MAX_PER_HOOD = 2;
/** Hoods are the benches in inoculation zones. */
export const isHood = (benchId: number | null) => {
  const b = db.benches.find((x) => x.benchId === benchId);
  return !!b && db.areas.find((a) => a.areaId === b.areaId)?.areaType === 'INOCULATION';
};

export const liveEntry = (e: ProductionEntry) => e.status !== 'REJECTED';

const trayOf = (id: number | null) => (id === null ? undefined : db.trays.find((t) => t.trayId === id));
/** Batch, stage and zone of an entry (older entries only have the tray). */
export function entryBatch(e: ProductionEntry): number | null {
  return e.batchId ?? trayOf(e.trayId)?.batchId ?? null;
}
export function entryStage(e: ProductionEntry): number | null {
  return e.stageId ?? trayOf(e.trayId)?.stageId ?? null;
}
export function entryArea(e: ProductionEntry): number | null {
  if (e.areaId !== undefined && e.areaId !== null) return e.areaId;
  const a = e.assignId !== null ? db.assignments.find((x) => x.assignId === e.assignId) : undefined;
  if (a?.areaId) return a.areaId;
  return db.users.find((u) => u.userId === e.operatorId)?.homeAreaId ?? null;
}
export const assignArea = (a: WorkAssignment): number | null =>
  a.areaId ?? db.benches.find((b) => b.benchId === a.benchId)?.areaId ?? db.users.find((u) => u.userId === a.operatorId)?.homeAreaId ?? null;

// ---------- the washing area's count ----------
/**
 * Bottles waiting to be washed. Every bottle that is sub-cultured is emptied and goes to the wash area;
 * every contaminated bottle (found at sub-culture or reported as a loss) goes to the wash area as a
 * contaminated bottle. Bottles washed are taken off. Unwashed bottles simply stay in the count.
 */
export function washPool(excludeEntryId?: number): { plain: number; contaminated: number } {
  let plain = 0;
  let contaminated = 0;
  const linked = new Set<number>();
  for (const e of db.entries) {
    if (!liveEntry(e) || e.entryId === excludeEntryId) continue;
    if (e.movementId !== null) linked.add(e.movementId);
    const k = kindOf(e);
    if (k === 'SUBCULTURE') {
      plain += e.bottlesHandled - e.bottlesLost;
      // Losses with a contamination record are counted from the record below.
      if (e.contId === null) contaminated += e.bottlesLost;
    } else if (k === 'WASH') {
      plain -= e.bottlesHandled - (e.contaminated ?? 0);
      contaminated -= e.contaminated ?? 0;
    }
  }
  // Sub-cultures done by supervisors from the Trays page have no entry. Old stage history (bench 0) is before the count starts.
  for (const m of db.movements) {
    if (linked.has(m.movementId) || m.fromBenchId === 0) continue;
    if (m.fromStageId === m.toStageId && m.bottlesIn === m.bottlesOut && m.bottlesLost === 0) continue; // bench move
    plain += m.bottlesIn - m.bottlesLost;
  }
  for (const c of db.contaminations) contaminated += c.bottlesLost;
  return { plain: Math.max(0, plain), contaminated: Math.max(0, contaminated) };
}

/** Bottles that reached the wash area on one day from sub-culture work done that day (plain, contaminated). */
export function washAddedOn(date: string): { plain: number; contaminated: number } {
  let plain = 0;
  let contaminated = 0;
  const linked = new Set(db.entries.filter((e) => e.movementId !== null).map((e) => e.movementId));
  for (const e of db.entries) {
    if (!liveEntry(e) || e.workDate !== date || kindOf(e) !== 'SUBCULTURE') continue;
    plain += e.bottlesHandled - e.bottlesLost;
    if (e.contId === null) contaminated += e.bottlesLost;
  }
  for (const m of db.movements) {
    if (linked.has(m.movementId) || m.fromBenchId === 0 || m.movedAt.slice(0, 10) !== date) continue;
    if (m.fromStageId === m.toStageId && m.bottlesIn === m.bottlesOut && m.bottlesLost === 0) continue;
    plain += m.bottlesIn - m.bottlesLost;
  }
  for (const c of db.contaminations) if (c.foundOn === date) contaminated += c.bottlesLost;
  return { plain, contaminated };
}

// ---------- media bottles ready, per media code ----------
/** Bottles of media ready to use for every media code (recipe), from lots that have not expired. */
export function mediaStatus(): { recipeId: number; code: string; bottles: number; lots: number }[] {
  return db.recipes.map((r) => {
    let bottles = 0;
    let lots = 0;
    for (const l of db.mediaLots) {
      if (l.recipeId !== r.recipeId || today() > l.expiresOn) continue;
      const used = db.trays.filter((t) => t.mediaLotId === l.mediaLotId).reduce((n, t) => n + (t.startBottles ?? t.bottleCount), 0);
      const left = Math.max(0, l.bottlesFilled - used);
      if (left > 0) {
        bottles += left;
        lots += 1;
      }
    }
    return { recipeId: r.recipeId, code: r.code, bottles, lots };
  });
}

/** Next free media batch code in the expert's pattern: B0001/26, B0002/26 … numbered within the year. */
export function nextMediaBatchCode(date = today()): string {
  const yy = date.slice(2, 4);
  let n = 0;
  for (const l of db.mediaLots) {
    const m = /^B(\d+)\/(\d\d)$/.exec(l.lotCode);
    if (m && m[2] === yy) n = Math.max(n, Number(m[1]));
  }
  for (const a of db.assignments) {
    const m = a.mediaBatchCode ? /^B(\d+)\/(\d\d)$/.exec(a.mediaBatchCode) : null;
    if (m && m[2] === yy) n = Math.max(n, Number(m[1]));
  }
  return `B${String(n + 1).padStart(4, '0')}/${yy}`;
}
