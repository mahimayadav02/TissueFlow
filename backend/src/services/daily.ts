// Daily work: attendance, work given to operators, work done (scanned or typed in), checking entries,
// the washing area's count and the output totals. A port of the website's rules
// (frontend/src/lib/dailyApi.ts and work.ts), with the same checks and messages.
//
// Each request loads the lab's working tables into memory (they are small for one lab), runs the same
// logic as the website, and writes only what changed. Changes run one at a time (a database lock), so two
// supervisors giving out the same bottles at the same moment cannot both succeed.
import type { AttStatus, EntryStatus, LossCause, LossType, Prisma, WorkKind } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../db/prisma.js';
import { addDays, dbDate, isoDate, labDate, labToday } from '../lib/dates.js';
import { ApiError } from '../middleware/errors.js';
import { MAX_GROWTH, checkLot, makeTrays, updateTray } from './production.js';

type Db = Prisma.TransactionClient;

const need: (ok: unknown, msg: string, status?: number) => asserts ok = (ok, msg, status = 400) => {
  if (!ok) throw new ApiError(status, msg);
};

export const WORK_LABEL: Record<WorkKind, string> = {
  SUBCULTURE: 'Sub-culture', WASH: 'Washing', MEDIA: 'Media making', QC_MEDIA: 'Media quality check', QC_CULTURE: 'Culture quality check',
};
/** The kinds of work done in each kind of zone. */
const KINDS_FOR_ZONE: Record<string, WorkKind[]> = {
  WASH: ['WASH'], MEDIA: ['MEDIA'], INOCULATION: ['SUBCULTURE'], INCUBATION: ['SUBCULTURE'], QC: ['QC_CULTURE', 'QC_MEDIA'],
};
/** Most operators that may work at one laminar-flow hood on the same day (domain expert). */
export const MAX_PER_HOOD = 2;
const TAKE_DAYS = 7;

// ---------- the lab's working tables, in memory (dates as YYYY-MM-DD) ----------
export interface Me {
  userId: number;
  role: 'MANAGER' | 'SUPERVISOR' | 'OPERATOR';
  homeAreaId: number | null;
  zoneIds: number[];
}
type U = Me & { fullName: string; status: string };
type Asg = {
  assignId: number; workDate: string; operatorId: number; kind: WorkKind; areaId: number | null; batchId: number | null; stageId: number | null;
  benchId: number | null; targetBottles: number; targetContaminated: number; recipeId: number | null; mediaBatchCode: string | null; assignedBy: number;
};
type Taken = { trayId: number; bottles: number };
type Ent = {
  entryId: number; assignId: number | null; operatorId: number; kind: WorkKind; source: 'QR' | 'MANUAL'; trayId: number | null; batchId: number | null;
  stageId: number | null; areaId: number | null; taken: Taken[] | null; contaminated: number; mediaLotId: number | null; enteredBy: number | null;
  movementId: number | null; contId: number | null; workDate: string; bottlesHandled: number; bottlesProduced: number; bottlesLost: number;
  status: EntryStatus; enteredAt: string; verifiedBy: number | null; verifiedAt: string | null; note: string;
};
type Tr = { trayId: number; qrCode: string; batchId: number; stageId: number; benchId: number; mediaLotId: number | null; bottleCount: number; startBottles: number | null; placedOn: string; status: string; version: number };
type Mov = { movementId: number; batchId: number; trayId: number | null; newTrayIds: number[]; takenTrayIds: number[]; fromStageId: number; toStageId: number; fromBenchId: number | null; bottlesIn: number; bottlesOut: number; bottlesLost: number; movedAt: string; movedDate: string };
type Lot = { mediaLotId: number; lotCode: string; recipeId: number; bottlesFilled: number; volumeLitre: number; expiresOn: string; preparedOn: string; preparedBy: number };

export async function loadCtx(db: Db = prisma) {
  const [users, areas, benches, stages, batches, crops, recipes, rule, lots, asgs, ents, atts, trays, movs, conts] = await Promise.all([
    db.user.findMany({ select: { userId: true, fullName: true, role: true, homeAreaId: true, status: true, zones: { select: { areaId: true } } } }),
    db.area.findMany({ orderBy: { areaId: 'asc' } }),
    db.bench.findMany({ orderBy: { benchId: 'asc' } }),
    db.stage.findMany({ orderBy: { seqNo: 'asc' } }),
    db.batch.findMany(),
    db.crop.findMany({ orderBy: { cropId: 'asc' } }),
    db.mediaRecipe.findMany({ orderBy: { recipeId: 'asc' } }),
    db.alertRule.findUnique({ where: { code: 'LOW_OUTPUT' } }),
    db.mediaLot.findMany(),
    db.workAssignment.findMany({ orderBy: { assignId: 'asc' } }),
    db.productionEntry.findMany({ orderBy: { entryId: 'asc' } }),
    db.attendance.findMany(),
    db.tray.findMany(),
    db.trayMovement.findMany({ orderBy: { movementId: 'asc' } }),
    db.contamination.findMany(),
  ]);
  return {
    users: users.map((u): U => ({ userId: u.userId, fullName: u.fullName, role: u.role, homeAreaId: u.homeAreaId, status: u.status, zoneIds: u.zones.map((z) => z.areaId) })),
    areas, benches, stages, crops, recipes, rule,
    batches: batches.map((b) => ({ batchId: b.batchId, batchCode: b.batchCode, cropId: b.cropId, status: b.status, parentBatchId: b.parentBatchId, startDate: isoDate(b.startDate) })),
    lots: lots.map((l): Lot => ({ mediaLotId: l.mediaLotId, lotCode: l.lotCode, recipeId: l.recipeId, bottlesFilled: l.bottlesFilled, volumeLitre: l.volumeLitre, expiresOn: isoDate(l.expiresOn), preparedOn: isoDate(l.preparedOn), preparedBy: l.preparedBy })),
    asgs: asgs.map((a): Asg => ({ ...a, workDate: isoDate(a.workDate) })),
    ents: ents.map((e): Ent => ({
      ...e, taken: (e.taken as Taken[] | null) ?? null, workDate: isoDate(e.workDate), enteredAt: e.enteredAt.toISOString(), verifiedAt: e.verifiedAt?.toISOString() ?? null,
    })),
    atts: atts.map((a) => ({ userId: a.userId, workDate: isoDate(a.workDate), status: a.status, markedBy: a.markedBy })),
    trays: trays.map((t): Tr => ({ ...t, placedOn: isoDate(t.placedOn) })),
    movs: movs.map((m): Mov => ({ ...m, movedAt: m.movedAt.toISOString(), movedDate: labDate(m.movedAt) })),
    conts: conts.map((c) => ({ ...c, foundOn: isoDate(c.foundOn) })),
  };
}
export type Ctx = Awaited<ReturnType<typeof loadCtx>>;

export const meOf = (req: Request): Me => {
  const u = req.user!;
  return { userId: u.userId, role: u.role, homeAreaId: u.homeAreaId, zoneIds: u.zoneIds };
};

/** Runs a change on its own: takes the lab's change lock, so changes that touch trays, stock or work run one at a time. */
export function locked<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4242)`;
    return fn(tx);
  });
}

/** A daily-work change: takes the lock, loads fresh tables and passes both on. */
export const change = <T>(fn: (tx: Db, c: Ctx) => Promise<T>): Promise<T> => locked(async (tx) => fn(tx, await loadCtx(tx)));

// ---------- small lookups ----------
const today = () => labToday();
export const workZones = (u: Pick<Me, 'homeAreaId' | 'zoneIds'>) => {
  const z = u.homeAreaId !== null ? [u.homeAreaId] : [];
  for (const id of u.zoneIds) if (!z.includes(id)) z.push(id);
  return z;
};
const visibleAreas = (u: Me): number[] | null => (u.role === 'MANAGER' ? null : u.role === 'SUPERVISOR' ? u.zoneIds : workZones(u));
const pctOf = (done: number, target: number) => (target > 0 ? Math.round((100 * done) / target) : null);
const live = (e: Ent) => e.status !== 'REJECTED';
const targetOf = (a: Asg) => a.targetBottles + (a.targetContaminated ?? 0);
export type Level = 'NONE' | 'OK' | 'WARNING' | 'CRITICAL';

/** The helpers, bound to one load of the tables. */
export function helpers(c: Ctx) {
  const userOf = (id: number | null | undefined) => c.users.find((u) => u.userId === id);
  const nameOf = (id: number | null | undefined) => userOf(id)?.fullName ?? '—';
  const stageOf = (id: number | null | undefined) => c.stages.find((s) => s.stageId === id);
  const stageCode = (id: number | null | undefined) => stageOf(id)?.code ?? '—';
  const batchCode = (id: number | null | undefined) => c.batches.find((b) => b.batchId === id)?.batchCode ?? '—';
  const benchOf = (id: number | null | undefined) => c.benches.find((b) => b.benchId === id);
  const benchCode = (id: number | null | undefined) => benchOf(id)?.code ?? '—';
  const areaOf = (id: number | null | undefined) => c.areas.find((a) => a.areaId === id);
  const areaName = (id: number | null | undefined) => areaOf(id)?.name ?? '—';
  const recipeCode = (id: number | null | undefined) => c.recipes.find((r) => r.recipeId === id)?.code ?? '—';
  const kindsForArea = (areaId: number | null | undefined): WorkKind[] => KINDS_FOR_ZONE[areaOf(areaId)?.areaType ?? ''] ?? ['SUBCULTURE'];
  const isHood = (benchId: number | null) => areaOf(benchOf(benchId)?.areaId)?.areaType === 'INOCULATION';
  const trayOf = (id: number | null) => (id === null ? undefined : c.trays.find((t) => t.trayId === id));
  const movementOf = (id: number | null) => (id === null ? undefined : c.movs.find((m) => m.movementId === id));
  const attOf = (userId: number, date: string): AttStatus | null => c.atts.find((a) => a.userId === userId && a.workDate === date)?.status ?? null;

  const entryBatch = (e: Ent) => e.batchId ?? trayOf(e.trayId)?.batchId ?? null;
  const entryStage = (e: Ent) => e.stageId ?? trayOf(e.trayId)?.stageId ?? null;
  const entryArea = (e: Ent): number | null => {
    if (e.areaId !== null) return e.areaId;
    const a = e.assignId !== null ? c.asgs.find((x) => x.assignId === e.assignId) : undefined;
    return a?.areaId ?? userOf(e.operatorId)?.homeAreaId ?? null;
  };
  const assignArea = (a: Asg): number | null => a.areaId ?? benchOf(a.benchId)?.areaId ?? userOf(a.operatorId)?.homeAreaId ?? null;

  /** Zones of this operator that the user looks after (all of them for the manager). */
  const sharedZones = (me: Me, op: U) => {
    const areas = visibleAreas(me);
    return workZones(op).filter((z) => areas === null || areas.includes(z));
  };
  /** Active operators the user is in charge of: anyone who works in at least one of the user's zones. */
  const myOperators = (me: Me) => {
    need(me.role !== 'OPERATOR', 'Only a supervisor or manager can do this.', 403);
    return c.users.filter((u) => u.role === 'OPERATOR' && u.status === 'ACTIVE' && sharedZones(me, u).length > 0);
  };
  const inCharge = (me: Me, operatorId: number) => myOperators(me).some((u) => u.userId === operatorId);

  const outputLevel = (pct: number | null, date: string): Level => {
    if (pct === null || date >= today()) return 'NONE';
    const r = c.rule;
    if (!r) return 'OK';
    if (r.criticalValue !== null && pct < r.criticalValue) return 'CRITICAL';
    return pct < r.warnValue ? 'WARNING' : 'OK';
  };

  /** Trays the user may take bottles from: own zones, plus (operator) batches given to them today. */
  const canSeeTray = (me: Me, t: Tr) => {
    const areas = visibleAreas(me);
    const a = benchOf(t.benchId)?.areaId;
    if (areas === null || (a !== undefined && areas.includes(a))) return true;
    const d = today();
    return me.role === 'OPERATOR' && c.asgs.some((x) => x.operatorId === me.userId && x.workDate === d && x.batchId === t.batchId);
  };
  const traysFor = (batchId: number, stageId: number, me: Me) =>
    c.trays
      .filter((t) => t.batchId === batchId && t.stageId === stageId && t.status === 'ACTIVE' && t.bottleCount > 0 && canSeeTray(me, t))
      .sort((a, b) => a.placedOn.localeCompare(b.placedOn) || a.trayId - b.trayId);

  const workLabel = (a: { kind: WorkKind; batchId: number | null; stageId: number | null; recipeId: number | null; mediaBatchCode: string | null }) =>
    a.kind === 'SUBCULTURE' ? `${batchCode(a.batchId)} · ${stageCode(a.stageId)}`
      : a.kind === 'MEDIA' ? `${recipeCode(a.recipeId)}${a.mediaBatchCode ? ` · ${a.mediaBatchCode}` : ''}` : WORK_LABEL[a.kind];

  // ---------- washing area count ----------
  const benchMove = (m: Mov) => m.fromStageId === m.toStageId && m.bottlesIn === m.bottlesOut && m.bottlesLost === 0;
  /**
   * Bottles waiting to be washed. Every bottle that is sub-cultured is emptied and goes to the wash area;
   * every contaminated bottle (found at sub-culture or reported as a loss) goes there as a contaminated bottle.
   * Bottles washed are taken off.
   */
  const washPool = () => {
    let plain = 0;
    let contaminated = 0;
    const linked = new Set<number>();
    for (const e of c.ents) {
      if (!live(e)) continue;
      if (e.movementId !== null) linked.add(e.movementId);
      if (e.kind === 'SUBCULTURE') {
        plain += e.bottlesHandled - e.bottlesLost;
        if (e.contId === null) contaminated += e.bottlesLost;
      } else if (e.kind === 'WASH') {
        plain -= e.bottlesHandled - e.contaminated;
        contaminated -= e.contaminated;
      }
    }
    // Sub-cultures done from the Trays page have no entry. Old stage history (no bench) is before the count starts.
    for (const m of c.movs) {
      if (linked.has(m.movementId) || m.fromBenchId === null || benchMove(m)) continue;
      plain += m.bottlesIn - m.bottlesLost;
    }
    for (const x of c.conts) contaminated += x.bottlesLost;
    return { plain: Math.max(0, plain), contaminated: Math.max(0, contaminated) };
  };
  /** Bottles that reached the wash area on one day from sub-culture work done that day. */
  const washAddedOn = (date: string) => {
    let plain = 0;
    let contaminated = 0;
    const linked = new Set(c.ents.filter((e) => e.movementId !== null).map((e) => e.movementId));
    for (const e of c.ents) {
      if (!live(e) || e.workDate !== date || e.kind !== 'SUBCULTURE') continue;
      plain += e.bottlesHandled - e.bottlesLost;
      if (e.contId === null) contaminated += e.bottlesLost;
    }
    for (const m of c.movs) {
      if (linked.has(m.movementId) || m.fromBenchId === null || m.movedDate !== date || benchMove(m)) continue;
      plain += m.bottlesIn - m.bottlesLost;
    }
    for (const x of c.conts) if (x.foundOn === date) contaminated += x.bottlesLost;
    return { plain, contaminated };
  };

  // ---------- media ----------
  const lotUsed = (lotId: number) => c.trays.filter((t) => t.mediaLotId === lotId).reduce((n, t) => n + (t.startBottles ?? t.bottleCount), 0);
  const mediaStatus = () =>
    c.recipes.map((r) => {
      let bottles = 0;
      let lots = 0;
      for (const l of c.lots) {
        if (l.recipeId !== r.recipeId || today() > l.expiresOn) continue;
        const left = Math.max(0, l.bottlesFilled - lotUsed(l.mediaLotId));
        if (left > 0) {
          bottles += left;
          lots += 1;
        }
      }
      return { recipeId: r.recipeId, code: r.code, bottles, lots };
    });
  /** Next free media batch code in the expert's pattern: B0001/26, B0002/26 … numbered within the year. */
  const nextMediaBatchCode = (date = today()) => {
    const yy = date.slice(2, 4);
    let n = 0;
    for (const code of [...c.lots.map((l) => l.lotCode), ...c.asgs.map((a) => a.mediaBatchCode ?? '')]) {
      const m = /^B(\d+)\/(\d\d)$/.exec(code);
      if (m && m[2] === yy) n = Math.max(n, Number(m[1]));
    }
    return `B${String(n + 1).padStart(4, '0')}/${yy}`;
  };

  const runningBatches = () => c.batches.filter((b) => b.status === 'RUNNING').map((b) => ({ batchId: b.batchId, batchCode: b.batchCode })).sort((a, b) => a.batchCode.localeCompare(b.batchCode));
  const cropList = () => c.crops.map((x) => ({ cropId: x.cropId, name: `${x.name} ${x.variety}` }));
  const findBatch = (code: string) => c.batches.find((b) => b.batchCode.toUpperCase() === code.trim().toUpperCase().replace(/\s+/g, ''));
  const stageByCode = (code: string) => {
    const k = code.trim().toUpperCase();
    need(k, 'Type the stage, for example M6.');
    const s = c.stages.find((x) => x.code.toUpperCase() === k);
    need(s, `Stage ${k} is not in the stage list. The manager can add it in Crops, stages and media.`);
    return s;
  };

  // ---------- rows for the pages ----------
  const assignmentRow = (a: Asg) => {
    const es = c.ents.filter((e) => e.assignId === a.assignId && live(e));
    const handled = es.reduce((n, e) => n + e.bottlesHandled, 0);
    const target = targetOf(a);
    const pct = pctOf(handled, target);
    const areaId = assignArea(a);
    return {
      ...a, areaId, areaName: areaName(areaId), operatorName: nameOf(a.operatorId), label: workLabel(a),
      batchCode: batchCode(a.batchId), stageCode: stageCode(a.stageId), benchCode: benchCode(a.benchId), recipeCode: recipeCode(a.recipeId),
      target, handled,
      produced: es.reduce((n, e) => n + e.bottlesProduced, 0),
      lost: es.reduce((n, e) => n + e.bottlesLost, 0),
      contaminated: es.reduce((n, e) => n + e.contaminated, 0),
      entries: es.length,
      pending: es.filter((e) => e.status === 'PENDING').length,
      pct, level: outputLevel(pct, a.workDate),
      returned: a.workDate < today() ? Math.max(0, target - handled) : 0,
      returnedTo: a.kind === 'SUBCULTURE' ? `stay in the ${batchCode(a.batchId)} · ${stageCode(a.stageId)} trays`
        : a.kind === 'WASH' ? 'stay in the wash area count' : a.kind === 'MEDIA' ? 'were not made' : 'were not checked',
    };
  };

  /** True when nothing has touched the new trays (and the trays bottles were taken from) since. */
  const traysUntouched = (e: Ent) => {
    const m = movementOf(e.movementId);
    if (!m) return false;
    const made = c.trays.filter((t) => m.newTrayIds.includes(t.trayId));
    if (made.length !== m.newTrayIds.length || made.some((t) => t.status !== 'ACTIVE' || t.bottleCount !== (t.startBottles ?? t.bottleCount))) return false;
    if (c.movs.some((x) => x.movementId !== m.movementId && ((x.trayId !== null && m.newTrayIds.includes(x.trayId)) || x.takenTrayIds.some((id) => m.newTrayIds.includes(id))))) return false;
    if (c.conts.some((x) => m.newTrayIds.includes(x.trayId))) return false;
    const source = e.taken?.map((x) => x.trayId) ?? (e.trayId !== null ? [e.trayId] : []);
    if (c.movs.some((x) => x.movementId > m.movementId && ((x.trayId !== null && source.includes(x.trayId)) || x.takenTrayIds.some((id) => source.includes(id))))) return false;
    return true;
  };
  /** A sent-back entry can be undone only if nothing has used what it made. */
  const canUndo = (e: Ent) => {
    if (e.status === 'REJECTED') return false;
    if (e.kind === 'SUBCULTURE') {
      if (!traysUntouched(e)) return false;
      if (e.taken) return true;
      const old = trayOf(e.trayId);
      return !!old && old.status !== 'ACTIVE';
    }
    if (e.kind === 'MEDIA') {
      const lot = c.lots.find((l) => l.mediaLotId === e.mediaLotId);
      return !!lot && lot.bottlesFilled - lotUsed(lot.mediaLotId) >= e.bottlesHandled;
    }
    return true;
  };

  const entryRow = (e: Ent) => {
    const t = trayOf(e.trayId);
    const b = entryBatch(e);
    const s = entryStage(e);
    const lot = e.mediaLotId ? c.lots.find((l) => l.mediaLotId === e.mediaLotId) : undefined;
    return {
      ...e,
      operatorName: nameOf(e.operatorId),
      qrCode: t?.qrCode ?? (e.taken ? `${e.taken.length} tray${e.taken.length === 1 ? '' : 's'}` : 'Typed in'),
      label: e.kind === 'SUBCULTURE' ? `${batchCode(b)} · ${stageCode(s)}` : e.kind === 'MEDIA' ? `${recipeCode(lot?.recipeId)}${lot ? ` · ${lot.lotCode}` : ''}` : WORK_LABEL[e.kind],
      batchCode: batchCode(b),
      stageCode: stageCode(s),
      areaName: areaName(entryArea(e)),
      verifiedByName: e.verifiedBy ? nameOf(e.verifiedBy) : null,
      enteredByName: e.enteredBy && e.enteredBy !== e.operatorId ? nameOf(e.enteredBy) : null,
      unassigned: e.assignId === null,
      undoable: canUndo(e),
    };
  };

  return {
    userOf, nameOf, stageOf, stageCode, batchCode, benchOf, areaOf, areaName, recipeCode, kindsForArea, isHood, trayOf, movementOf, attOf,
    entryBatch, entryStage, entryArea, assignArea, sharedZones, myOperators, inCharge, outputLevel, canSeeTray, traysFor, workLabel,
    washPool, washAddedOn, lotUsed, mediaStatus, nextMediaBatchCode, runningBatches, cropList, findBatch, stageByCode,
    assignmentRow, entryRow, canUndo,
  };
}
export type H = ReturnType<typeof helpers>;

// =====================================================================================================
// Reads
// =====================================================================================================

export function getAttendance(c: Ctx, me: Me, date: string) {
  const h = helpers(c);
  return h.myOperators(me).map((u) => {
    const a = c.atts.find((x) => x.userId === u.userId && x.workDate === date);
    return { userId: u.userId, fullName: u.fullName, areaName: workZones(u).map(h.areaName).join(', '), status: a?.status ?? null, markedByName: a ? h.nameOf(a.markedBy) : null };
  }).sort((a, b) => a.areaName.localeCompare(b.areaName) || a.fullName.localeCompare(b.fullName));
}

export function assignOptions(c: Ctx, me: Me, date: string) {
  const h = helpers(c);
  const areas = visibleAreas(me);
  const meU = h.userOf(me.userId)!;
  const ops = me.role === 'OPERATOR' ? [meU] : h.myOperators(me);
  const inScope = (benchId: number) => {
    const a = h.benchOf(benchId)?.areaId;
    return areas === null || (a !== undefined && areas.includes(a));
  };
  const day = c.asgs.filter((a) => a.workDate === date);
  const taken = (batchId: number, stageId: number) =>
    day.filter((a) => a.kind === 'SUBCULTURE' && a.batchId === batchId && a.stageId === stageId).reduce((n, a) => n + a.targetBottles, 0);
  const batches = c.batches
    .filter((b) => b.status === 'RUNNING')
    .map((b) => {
      const ts = c.trays.filter((t) => t.batchId === b.batchId && t.status === 'ACTIVE' && inScope(t.benchId));
      return {
        batchId: b.batchId,
        batchCode: b.batchCode,
        stages: c.stages
          .map((s) => {
            const st = ts.filter((t) => t.stageId === s.stageId);
            const bottles = st.reduce((n, t) => n + t.bottleCount, 0);
            return { stageId: s.stageId, code: s.code, bottles, trays: st.length, free: Math.max(0, bottles - taken(b.batchId, s.stageId)) };
          })
          .filter((s) => s.trays > 0),
      };
    })
    .filter((b) => b.stages.length > 0);
  const zoneOpt = (id: number) => {
    const a = h.areaOf(id);
    return a ? { areaId: a.areaId, name: a.name, areaType: a.areaType, kinds: h.kindsForArea(a.areaId) } : null;
  };
  const zonesOf = (o: U) => (me.role === 'OPERATOR' ? workZones(o) : h.sharedZones(me, o));
  const opZones = new Set(ops.flatMap(zonesOf));
  const pool = h.washPool();
  const washLines = day.filter((a) => a.kind === 'WASH');
  const added = h.washAddedOn(date);
  return {
    operators: ops.map((o) => ({
      userId: o.userId, fullName: o.fullName, areaId: o.homeAreaId,
      zones: zonesOf(o).map(zoneOpt).filter((z): z is NonNullable<typeof z> => z !== null),
      attendance: h.attOf(o.userId, date),
    })),
    batches,
    benches: c.benches.filter((b) => opZones.has(b.areaId)).map((b) => ({
      ...b, areaName: h.areaName(b.areaId), hood: h.isHood(b.benchId),
      operatorIds: [...new Set(day.filter((a) => a.benchId === b.benchId).map((a) => a.operatorId))],
    })),
    wash: {
      plain: pool.plain, contaminated: pool.contaminated,
      givenPlain: washLines.reduce((n, a) => n + a.targetBottles, 0),
      givenContaminated: washLines.reduce((n, a) => n + a.targetContaminated, 0),
      addedPlain: added.plain, addedContaminated: added.contaminated,
    },
    media: h.mediaStatus(),
    nextMediaBatchCode: h.nextMediaBatchCode(date),
    maxPerHood: MAX_PER_HOOD,
    allBatches: h.runningBatches(),
    stageCodes: c.stages.map((s) => s.code),
    crops: h.cropList(),
  };
}
export type AssignOptions = ReturnType<typeof assignOptions>;

export function listAssignments(c: Ctx, me: Me, date: string) {
  const h = helpers(c);
  const ids = new Set(me.role === 'OPERATOR' ? [me.userId] : h.myOperators(me).map((u) => u.userId));
  const areas = visibleAreas(me);
  return c.asgs
    .filter((a) => a.workDate === date && ids.has(a.operatorId))
    .map(h.assignmentRow)
    // A supervisor sees only the lines in their own zones (an operator in two zones may also have work from another supervisor).
    .filter((a) => me.role !== 'SUPERVISOR' || areas === null || (a.areaId !== null && areas.includes(a.areaId)))
    .sort((a, b) => a.operatorName.localeCompare(b.operatorName));
}

/** One row per operator: target against work done that day. With areaId, only that zone counts. */
export function dailyBoard(c: Ctx, me: Me, date: string, areaId?: number) {
  const h = helpers(c);
  const areas = visibleAreas(me);
  const here = (z: number | null) => (areaId !== undefined ? z === areaId : me.role !== 'SUPERVISOR' || areas === null || (z !== null && areas.includes(z)));
  return h.myOperators(me).map((u) => {
    const as = c.asgs.filter((a) => a.workDate === date && a.operatorId === u.userId && here(h.assignArea(a))).map(h.assignmentRow);
    const es = c.ents.filter((e) => e.workDate === date && e.operatorId === u.userId && live(e) && here(h.entryArea(e)));
    const target = as.reduce((n, a) => n + a.target, 0);
    const handled = es.reduce((n, e) => n + e.bottlesHandled, 0);
    const pct = pctOf(handled, target);
    const zones = [...new Set(as.map((a) => a.areaName))];
    return {
      operatorId: u.userId, fullName: u.fullName,
      areaName: zones.length ? zones.join(', ') : workZones(u).map(h.areaName).join(', '),
      attendance: h.attOf(u.userId, date),
      work: as.map((a) => a.label),
      target, handled,
      produced: es.reduce((n, e) => n + e.bottlesProduced, 0),
      lost: es.reduce((n, e) => n + (e.kind === 'SUBCULTURE' ? e.bottlesLost : 0), 0),
      pending: es.filter((e) => e.status === 'PENDING').length,
      pct, level: h.outputLevel(pct, date),
    };
  }).sort((a, b) => a.areaName.localeCompare(b.areaName) || a.fullName.localeCompare(b.fullName));
}

/** Everything the "Record work" form needs for one operator and day. */
export function entryOptions(c: Ctx, me: Me, date: string, operatorId: number) {
  const h = helpers(c);
  const op = h.userOf(operatorId);
  need(op && op.role === 'OPERATOR', 'Choose the operator.');
  const isOp = me.role === 'OPERATOR';
  if (isOp) need(operatorId === me.userId, 'You can only enter your own work.', 403);
  else need(h.inCharge(me, operatorId), `${op.fullName} is not in your zones.`, 403);
  const zones = (isOp ? workZones(op) : h.sharedZones(me, op))
    .map((id) => h.areaOf(id))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => ({ areaId: a.areaId, name: a.name, areaType: a.areaType, kinds: h.kindsForArea(a.areaId) }));
  const zoneIds = new Set(zones.map((z) => z.areaId));
  const batches = c.batches.filter((b) => b.status === 'RUNNING').map((b) => ({
    batchId: b.batchId,
    batchCode: b.batchCode,
    growth: c.crops.find((x) => x.cropId === b.cropId)?.defaultGrowth ?? 2.5,
    stages: c.stages.map((s) => {
      const ts = h.traysFor(b.batchId, s.stageId, me);
      return { stageId: s.stageId, code: s.code, bottles: ts.reduce((n, t) => n + t.bottleCount, 0), trays: ts.length, benchId: ts[0]?.benchId ?? null };
    }).filter((s) => s.bottles > 0),
  })).filter((b) => b.stages.length > 0);
  const areas = visibleAreas(me);
  // New bottles go onto racks: benches in the growth room and hardening, plus any bench in the user's own zones.
  const rackZone = (areaId: number) => ['INCUBATION', 'HARDENING'].includes(h.areaOf(areaId)?.areaType ?? '');
  const benches = c.benches
    .filter((b) => rackZone(b.areaId) || areas === null || areas.includes(b.areaId))
    .map((b) => ({ benchId: b.benchId, code: b.code, areaName: h.areaName(b.areaId), capacity: b.capacityTrays, trays: c.trays.filter((t) => t.status === 'ACTIVE' && t.benchId === b.benchId).length }));
  return {
    operator: { userId: op.userId, fullName: op.fullName, attendance: h.attOf(op.userId, date) },
    lines: c.asgs.filter((a) => a.operatorId === operatorId && a.workDate === date && zoneIds.has(h.assignArea(a) ?? -1)).map(h.assignmentRow),
    zones,
    batches,
    stages: c.stages.map((s) => ({ stageId: s.stageId, code: s.code, phase: s.phase, seqNo: s.seqNo })),
    benches,
    wash: h.washPool(),
    media: h.mediaStatus(),
    nextMediaBatchCode: h.nextMediaBatchCode(date),
    allBatches: h.runningBatches(),
    crops: h.cropList(),
  };
}

export function listEntries(c: Ctx, me: Me, f: { status?: EntryStatus; from?: string; to?: string }) {
  const h = helpers(c);
  const ids = new Set(me.role === 'OPERATOR' ? [me.userId] : h.myOperators(me).map((u) => u.userId));
  const areas = visibleAreas(me);
  return c.ents
    .filter((e) => ids.has(e.operatorId) && (!f.status || e.status === f.status) && (!f.from || e.workDate >= f.from) && (!f.to || e.workDate <= f.to))
    .filter((e) => me.role !== 'SUPERVISOR' || areas === null || areas.includes(h.entryArea(e) ?? -1))
    .map(h.entryRow)
    .sort((a, b) => b.enteredAt.localeCompare(a.enteredAt));
}

export interface OutputFilter {
  from: string;
  to: string;
  operatorId?: number;
  areaId?: number;
  kind?: WorkKind;
  batchId?: number;
  stageId?: number;
}

/** Day totals of all work, then split by operator, zone, kind of work, batch and stage. */
export function workOutput(c: Ctx, me: Me, f: OutputFilter) {
  const h = helpers(c);
  need(f.from <= f.to, 'The start date must be on or before the end date.');
  const areas = visibleAreas(me);
  const isOp = me.role === 'OPERATOR';
  const opIds = new Set(isOp ? [me.userId] : h.myOperators(me).map((u) => u.userId));
  const zoneOk = (areaId: number | null) => isOp || me.role === 'MANAGER' || areas === null || (areaId !== null && areas.includes(areaId));
  const inRange = (d: string) => d >= f.from && d <= f.to;

  const allE = c.ents.filter((e) => live(e) && inRange(e.workDate) && opIds.has(e.operatorId) && zoneOk(h.entryArea(e)));
  const allA = c.asgs.filter((a) => inRange(a.workDate) && opIds.has(a.operatorId) && zoneOk(h.assignArea(a)));
  type Row = { date: string; operatorId: number; kind: WorkKind; areaId: number | null; batchId: number | null; stageId: number | null };
  const pass = (x: Row) =>
    (!f.operatorId || x.operatorId === f.operatorId) && (!f.kind || x.kind === f.kind) && (!f.areaId || x.areaId === f.areaId)
    && (!f.batchId || x.batchId === f.batchId) && (!f.stageId || x.stageId === f.stageId);
  const es = allE.map((e) => ({ e, date: e.workDate, operatorId: e.operatorId, kind: e.kind, areaId: h.entryArea(e), batchId: h.entryBatch(e), stageId: h.entryStage(e) })).filter(pass);
  const as = allA.map((a) => ({ a, date: a.workDate, operatorId: a.operatorId, kind: a.kind, areaId: h.assignArea(a), batchId: a.batchId, stageId: a.stageId })).filter(pass);

  type Group = { key: string; label: string; filter: Partial<OutputFilter>; target: number; handled: number; produced: number; lost: number; entries: number; pct: number | null };
  const group = (keyOf: (x: Row) => string | null, labelOf: (k: string) => string, filterOf: (k: string) => Partial<OutputFilter>): Group[] => {
    const g = new Map<string, Group>();
    const get = (k: string) => {
      let r = g.get(k);
      if (!r) g.set(k, (r = { key: k, label: labelOf(k), filter: filterOf(k), target: 0, handled: 0, produced: 0, lost: 0, entries: 0, pct: null }));
      return r;
    };
    for (const x of es) {
      const k = keyOf(x);
      if (k === null) continue;
      const r = get(k);
      r.handled += x.e.bottlesHandled;
      r.produced += x.e.bottlesProduced;
      r.lost += x.e.bottlesLost;
      r.entries += 1;
    }
    for (const x of as) {
      const k = keyOf(x);
      if (k !== null) get(k).target += targetOf(x.a);
    }
    return [...g.values()].map((r) => ({ ...r, pct: pctOf(r.handled, r.target) }));
  };
  const byHandled = (a: Group, b: Group) => b.handled - a.handled || a.label.localeCompare(b.label);
  const seq = (id: number) => h.stageOf(id)?.seqNo ?? 0;
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];

  return {
    totals: {
      target: as.reduce((n, x) => n + targetOf(x.a), 0),
      handled: es.reduce((n, x) => n + x.e.bottlesHandled, 0),
      produced: es.reduce((n, x) => n + x.e.bottlesProduced, 0),
      lost: es.reduce((n, x) => n + (x.kind === 'SUBCULTURE' ? x.e.bottlesLost : 0), 0),
      entries: es.length,
      pending: es.filter((x) => x.e.status === 'PENDING').length,
      operators: uniq(es.map((x) => x.operatorId)).length,
      days: uniq(es.map((x) => x.e.workDate)).length,
    },
    byDay: group((x) => x.date, (k) => k, (k) => ({ from: k, to: k })).map((r) => ({ ...r, date: r.key })).sort((a, b) => b.date.localeCompare(a.date)),
    byOperator: group((x) => String(x.operatorId), (k) => h.nameOf(Number(k)), (k) => ({ operatorId: Number(k) })).sort(byHandled),
    byZone: group((x) => (x.areaId === null ? null : String(x.areaId)), (k) => h.areaName(Number(k)), (k) => ({ areaId: Number(k) })).sort(byHandled),
    byKind: group((x) => x.kind, (k) => WORK_LABEL[k as WorkKind], (k) => ({ kind: k as WorkKind })).sort(byHandled),
    byBatch: group((x) => (x.kind === 'SUBCULTURE' && x.batchId !== null ? String(x.batchId) : null), (k) => h.batchCode(Number(k)), (k) => ({ batchId: Number(k), kind: 'SUBCULTURE' as const })).sort(byHandled),
    byStage: group((x) => (x.kind === 'SUBCULTURE' && x.stageId !== null ? String(x.stageId) : null), (k) => h.stageCode(Number(k)), (k) => ({ stageId: Number(k), kind: 'SUBCULTURE' as const }))
      .sort((a, b) => seq(Number(a.key)) - seq(Number(b.key))),
    entries: es.map((x) => h.entryRow(x.e)).sort((a, b) => b.workDate.localeCompare(a.workDate) || b.enteredAt.localeCompare(a.enteredAt)).slice(0, 400),
    options: {
      operators: uniq([...allE.map((e) => e.operatorId), ...allA.map((a) => a.operatorId)]).map((id) => ({ userId: id, fullName: h.nameOf(id) })).sort((a, b) => a.fullName.localeCompare(b.fullName)),
      zones: uniq([...allE.map(h.entryArea), ...allA.map(h.assignArea)].filter((z): z is number => z !== null)).map((id) => ({ areaId: id, name: h.areaName(id) })).sort((a, b) => a.name.localeCompare(b.name)),
      batches: uniq([...allE.map(h.entryBatch), ...allA.map((a) => a.batchId)].filter((z): z is number => z !== null)).map((id) => ({ batchId: id, batchCode: h.batchCode(id) })).sort((a, b) => a.batchCode.localeCompare(b.batchCode)),
      stages: uniq([...allE.map(h.entryStage), ...allA.map((a) => a.stageId)].filter((z): z is number => z !== null)).sort((a, b) => seq(a) - seq(b)).map((id) => ({ stageId: id, code: h.stageCode(id) })),
      kinds: uniq([...allE.map((e) => e.kind), ...allA.map((a) => a.kind)]),
    },
  };
}

/** An operator's own day totals for the last `days` days. */
export function myOutput(c: Ctx, me: Me, days: number) {
  const h = helpers(c);
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today(), -i);
    const as = c.asgs.filter((a) => a.workDate === d && a.operatorId === me.userId);
    const es = c.ents.filter((e) => e.workDate === d && e.operatorId === me.userId && live(e));
    const att = h.attOf(me.userId, d);
    if (!as.length && !es.length && !att) continue;
    const target = as.reduce((n, a) => n + targetOf(a), 0);
    const handled = es.reduce((n, e) => n + e.bottlesHandled, 0);
    const pct = pctOf(handled, target);
    out.push({
      workDate: d, attendance: att, target, handled,
      produced: es.reduce((n, e) => n + e.bottlesProduced, 0),
      lost: es.reduce((n, e) => n + e.bottlesLost, 0),
      pending: es.filter((e) => e.status === 'PENDING').length,
      verified: es.filter((e) => e.status === 'VERIFIED').length,
      pct, level: h.outputLevel(pct, d),
    });
  }
  return out;
}

export function mySentBack(c: Ctx, me: Me) {
  const h = helpers(c);
  const from = addDays(today(), -3);
  return c.ents.filter((e) => e.operatorId === me.userId && e.status === 'REJECTED' && e.workDate >= from).map(h.entryRow);
}

// =====================================================================================================
// Changes (each runs inside change(), so the tables in `c` are fresh and nobody else is changing them)
// =====================================================================================================

export async function markAttendance(tx: Db, c: Ctx, me: Me, date: string, marks: { userId: number; status: AttStatus }[]) {
  const h = helpers(c);
  need(date <= today(), 'Attendance cannot be marked for a future date.');
  need(date >= addDays(today(), -TAKE_DAYS), `Attendance older than ${TAKE_DAYS} days cannot be changed.`);
  need(marks.length > 0, 'Mark at least one person.');
  for (const m of marks) {
    need(h.inCharge(me, m.userId), `${h.nameOf(m.userId)} is not in your zones.`, 403);
    if (m.status === 'A') {
      const started = c.ents.some((e) => e.operatorId === m.userId && e.workDate === date && live(e));
      need(!started, `${h.nameOf(m.userId)} already has work entries on this day, so cannot be marked absent.`);
    }
  }
  for (const m of marks) {
    await tx.attendance.upsert({
      where: { userId_workDate: { userId: m.userId, workDate: dbDate(date) } },
      create: { userId: m.userId, workDate: dbDate(date), status: m.status, markedBy: me.userId },
      update: { status: m.status, markedBy: me.userId },
    });
  }
}

export interface AssignInput {
  assignId?: number;
  workDate: string;
  operatorId: number;
  kind: WorkKind;
  areaId?: number | null;
  batchId?: number | null;
  stageId?: number | null;
  batchCode?: string;
  stageCode?: string;
  cropId?: number | null;
  benchId: number | null;
  targetBottles: number;
  targetContaminated?: number;
  recipeId?: number | null;
  mediaBatchCode?: string;
}

/** Adds or changes one line of work. Keeps `c` up to date, so several lines can be saved in a row. */
export async function saveAssignment(tx: Db, c: Ctx, me: Me, input: AssignInput) {
  const h = helpers(c);
  const kind = input.kind;
  need(input.workDate >= today(), 'Work can only be given for today or a later date.');
  need(h.inCharge(me, input.operatorId), 'This operator is not in your zones.', 403);
  need(h.attOf(input.operatorId, input.workDate) !== 'A', `${h.nameOf(input.operatorId)} is marked absent on this day.`);
  const op = h.userOf(input.operatorId)!;
  const zones = h.sharedZones(me, op);
  const areaId = input.areaId ?? zones[0] ?? null;
  need(areaId !== null && zones.includes(areaId), `Choose one of ${op.fullName}’s zones that you look after.`);
  need(h.kindsForArea(areaId).includes(kind), `${WORK_LABEL[kind]} is not done in ${h.areaName(areaId)}.`);
  const old = input.assignId ? c.asgs.find((a) => a.assignId === input.assignId) : undefined;
  if (input.assignId) need(old, 'Work line not found.', 404);
  if (old) need(h.inCharge(me, old.operatorId), 'This operator is not in your zones.', 403);
  const opts = assignOptions(c, me, input.workDate);
  const row = {
    workDate: input.workDate, operatorId: input.operatorId, kind, areaId, batchId: null as number | null, stageId: null as number | null,
    benchId: input.benchId, targetBottles: input.targetBottles, targetContaminated: 0, recipeId: null as number | null, mediaBatchCode: null as string | null,
  };

  // A typed batch that is not in the app yet is added only once everything else checks out.
  let newBatch: { code: string; cropId: number } | null = null;
  if (kind === 'SUBCULTURE') {
    need(input.targetBottles > 0, 'Target must be more than 0 bottles.');
    let batchId = input.batchId ?? null;
    let stageId = input.stageId ?? null;
    if (input.stageCode !== undefined) stageId = h.stageByCode(input.stageCode).stageId;
    if (input.batchCode !== undefined) {
      const f = h.findBatch(input.batchCode);
      if (f) {
        need(f.status === 'RUNNING', `Batch ${f.batchCode} is closed.`);
        batchId = f.batchId;
      } else {
        const code = input.batchCode.trim().toUpperCase().replace(/\s+/g, '');
        need(code.length >= 2 && code.length <= 20, 'Type the batch code, for example B1-26.');
        need(c.crops.some((x) => x.cropId === input.cropId), `Batch ${code} is new. Choose its crop so it can be added.`);
        newBatch = { code, cropId: input.cropId! };
        batchId = null;
      }
    }
    need(newBatch || batchId, 'Type the batch code.');
    need(stageId, 'Type the stage.');
    if (batchId !== null) need(c.batches.some((b) => b.batchId === batchId && b.status === 'RUNNING'), 'Choose a running batch.');
    const recorded = batchId !== null && c.trays.some((t) => t.batchId === batchId && t.stageId === stageId && t.status === 'ACTIVE' && t.bottleCount > 0);
    if (recorded) {
      // Bottles are in the app: the target cannot be more than what is not yet given out.
      const st = opts.batches.find((b) => b.batchId === batchId)?.stages.find((s) => s.stageId === stageId);
      need(st, `The ${h.batchCode(batchId)} trays at ${h.stageCode(stageId)} are not in your zones.`);
      const free = st.free + (old && old.kind === 'SUBCULTURE' && old.batchId === batchId && old.stageId === stageId ? old.targetBottles : 0);
      need(input.targetBottles <= free, `Only ${free} bottles of ${h.batchCode(batchId)} at ${st.code} are left to give out on this day.`);
    }
    row.batchId = batchId;
    row.stageId = stageId;
  } else if (kind === 'WASH') {
    const tc = input.targetContaminated ?? 0;
    need(input.targetBottles + tc > 0, 'Give a target for bottles to wash, contaminated bottles to wash, or both.');
    const mine = old && old.kind === 'WASH' ? old : undefined;
    const freePlain = Math.max(0, opts.wash.plain - opts.wash.givenPlain + (mine?.targetBottles ?? 0));
    const freeCont = Math.max(0, opts.wash.contaminated - opts.wash.givenContaminated + (mine?.targetContaminated ?? 0));
    need(input.targetBottles <= freePlain, `Only ${freePlain} bottles are waiting to be washed and not yet given out.`);
    need(tc <= freeCont, `Only ${freeCont} contaminated bottles are waiting to be washed and not yet given out.`);
    row.targetContaminated = tc;
  } else if (kind === 'MEDIA') {
    need(input.targetBottles > 0, 'Enter the number of bottles to be made.');
    need(c.recipes.some((r) => r.recipeId === input.recipeId), 'Choose the media code.');
    const code = (input.mediaBatchCode ?? '').trim();
    need(code.length >= 2 && code.length <= 20, 'Enter the batch code for this media (for example B0001/26).');
    const lot = c.lots.find((l) => l.lotCode.toLowerCase() === code.toLowerCase());
    need(!lot || lot.recipeId === input.recipeId, `Batch code ${code} is already used for ${h.recipeCode(lot?.recipeId)} media.`);
    need(!c.asgs.some((a) => a.assignId !== input.assignId && a.mediaBatchCode?.toLowerCase() === code.toLowerCase() && a.recipeId !== input.recipeId),
      `Batch code ${code} is already given out for another media code.`);
    row.recipeId = input.recipeId!;
    row.mediaBatchCode = code;
  } else {
    need(input.targetBottles > 0, 'Enter the number of bottles to check.');
  }

  if (input.benchId !== null) {
    const bench = opts.benches.find((b) => b.benchId === input.benchId);
    need(bench && bench.areaId === areaId, `Choose a bench in ${h.areaName(areaId)}.`);
    if (bench.hood) {
      const others = bench.operatorIds.filter((id) => id !== input.operatorId);
      need(others.length < MAX_PER_HOOD, `${bench.code} already has ${MAX_PER_HOOD} operators on this day (${others.map(h.nameOf).join(', ')}). Each hood takes at most ${MAX_PER_HOOD}.`);
    }
  }
  const same = c.asgs.some((b) => {
    if (b.workDate !== row.workDate || b.operatorId !== row.operatorId || b.kind !== kind || b.assignId === input.assignId) return false;
    if (kind === 'SUBCULTURE') return !newBatch && b.batchId === row.batchId && b.stageId === row.stageId;
    if (kind === 'MEDIA') return b.recipeId === row.recipeId && (b.mediaBatchCode ?? '') === row.mediaBatchCode;
    return true;
  });
  need(!same, 'This operator already has this work on this day. Change that line instead.');
  if (old) {
    const started = c.ents.some((e) => e.assignId === old.assignId);
    need(old.operatorId === input.operatorId || !started, 'Work has started on this line, so the operator cannot be changed.');
    need(old.kind === kind || !c.ents.some((e) => e.assignId === old.assignId && live(e)), 'Work has started on this line, so its kind cannot be changed.');
  }
  if (newBatch) row.batchId = (await addBatch(tx, c, newBatch.code, newBatch.cropId, input.workDate)).batchId;

  const data = { ...row, workDate: dbDate(row.workDate), assignedBy: me.userId };
  const saved = old
    ? await tx.workAssignment.update({ where: { assignId: old.assignId }, data })
    : await tx.workAssignment.create({ data });
  const mem: Asg = { ...saved, workDate: isoDate(saved.workDate) };
  if (old) c.asgs[c.asgs.indexOf(old)] = mem;
  else c.asgs.push(mem);
  return h.assignmentRow(mem);
}

/** Adds a batch the lab typed in that is not in the app yet. */
async function addBatch(tx: Db, c: Ctx, code: string, cropId: number, date: string) {
  const b = await tx.batch.create({ data: { batchCode: code, cropId, startDate: dbDate(date) } });
  c.batches.push({ batchId: b.batchId, batchCode: b.batchCode, cropId: b.cropId, status: b.status, parentBatchId: b.parentBatchId, startDate: isoDate(b.startDate) });
  return b;
}

export async function deleteAssignment(tx: Db, c: Ctx, me: Me, assignId: number) {
  const h = helpers(c);
  const a = c.asgs.find((x) => x.assignId === assignId);
  need(a, 'Not found.', 404);
  need(h.inCharge(me, a.operatorId), 'This operator is not in your zones.', 403);
  need(!c.ents.some((e) => e.assignId === assignId && live(e)), 'Work has already been entered for this line, so it cannot be removed.', 409);
  // Entries sent back keep their record but no longer point at the line.
  await tx.productionEntry.updateMany({ where: { assignId }, data: { assignId: null } });
  await tx.workAssignment.delete({ where: { assignId } });
}

/** Copies the last working day's work to this date for operators who are not absent. Returns how many lines were added. */
export async function copyPreviousDay(tx: Db, c: Ctx, me: Me, date: string) {
  const h = helpers(c);
  need(date >= today(), 'Work can only be given for today or a later date.');
  const ids = new Set(h.myOperators(me).map((u) => u.userId));
  const areas = visibleAreas(me);
  const mine = (a: Asg) => ids.has(a.operatorId) && (areas === null || areas.includes(h.assignArea(a) ?? -1));
  let from = '';
  for (let i = 1; i <= TAKE_DAYS && !from; i++) {
    const d = addDays(date, -i);
    if (c.asgs.some((a) => a.workDate === d && mine(a))) from = d;
  }
  need(from, `No work was given in the last ${TAKE_DAYS} days to copy from.`);
  let added = 0;
  for (const a of c.asgs.filter((x) => x.workDate === from && mine(x))) {
    if (h.attOf(a.operatorId, date) === 'A') continue;
    const opts = assignOptions(c, me, date);
    const input: AssignInput = {
      workDate: date, operatorId: a.operatorId, kind: a.kind, areaId: h.assignArea(a), batchId: a.batchId, stageId: a.stageId, benchId: a.benchId,
      targetBottles: a.targetBottles, targetContaminated: a.targetContaminated, recipeId: a.recipeId,
      // Media gets a new batch code every day.
      mediaBatchCode: a.kind === 'MEDIA' ? opts.nextMediaBatchCode : undefined,
    };
    if (a.kind === 'SUBCULTURE') {
      input.targetBottles = Math.min(a.targetBottles, opts.batches.find((b) => b.batchId === a.batchId)?.stages.find((s) => s.stageId === a.stageId)?.free ?? 0);
    } else if (a.kind === 'WASH') {
      input.targetBottles = Math.min(a.targetBottles, Math.max(0, opts.wash.plain - opts.wash.givenPlain));
      input.targetContaminated = Math.min(a.targetContaminated, Math.max(0, opts.wash.contaminated - opts.wash.givenContaminated));
    }
    try {
      await saveAssignment(tx, c, me, input);
      added++;
    } catch (e) {
      // Already given, no bottles left, or hood full: skip this line. Anything else is a real error.
      if (!(e instanceof ApiError)) throw e;
    }
  }
  return added;
}

export interface WorkInput {
  operatorId: number;
  workDate: string;
  assignId?: number | null;
  kind: WorkKind;
  areaId?: number | null;
  bottlesHandled: number;
  batchId?: number | null;
  stageId?: number | null;
  batchCode?: string;
  stageCode?: string;
  cropId?: number | null;
  bottlesOut?: number;
  bottlesLost?: number;
  toStageId?: number;
  toBenchId?: number;
  mediaLotId?: number | null;
  cause?: LossCause;
  contType?: LossType;
  contaminated?: number;
  recipeId?: number | null;
  mediaBatchCode?: string;
  litres?: number;
  note?: string;
}

/**
 * Work typed in by hand instead of scanning a tray. The operator enters their own work for today;
 * a supervisor can enter it for an operator (up to 7 days back), and then it counts as checked.
 */
export async function enterWork(tx: Db, c: Ctx, me: Me, input: WorkInput) {
  const h = helpers(c);
  const isOp = me.role === 'OPERATOR';
  const op = h.userOf(input.operatorId);
  need(op && op.role === 'OPERATOR', 'Choose the operator.');
  if (isOp) {
    need(input.operatorId === me.userId, 'You can only enter your own work.', 403);
    need(input.workDate === today(), 'Work can be entered for today only. Ask your supervisor to add an earlier day.');
  } else {
    need(h.inCharge(me, input.operatorId), `${op.fullName} is not in your zones.`, 403);
    need(input.workDate <= today() && input.workDate >= addDays(today(), -TAKE_DAYS), `Work can be entered for today or up to ${TAKE_DAYS} days back.`);
  }
  need(h.attOf(input.operatorId, input.workDate) !== 'A', `${op.fullName} is marked absent on this day.`);
  const kind = input.kind;
  let line = input.assignId ? c.asgs.find((a) => a.assignId === input.assignId) : undefined;
  if (input.assignId) need(line && line.operatorId === input.operatorId && line.workDate === input.workDate, 'That work line is not for this operator and day.');
  if (!line) {
    line = c.asgs.find((a) => a.operatorId === input.operatorId && a.workDate === input.workDate && a.kind === kind
      && (kind !== 'SUBCULTURE' || (a.batchId === input.batchId && a.stageId === input.stageId))
      && (kind !== 'MEDIA' || a.recipeId === input.recipeId));
  }
  if (line) need(line.kind === kind, 'This entry is a different kind of work from the line chosen.');
  const zones = isOp ? workZones(op) : h.sharedZones(me, op);
  const areaId = (line ? h.assignArea(line) : null) ?? input.areaId ?? zones.find((z) => h.kindsForArea(z).includes(kind)) ?? null;
  need(areaId !== null && workZones(op).includes(areaId), `Choose one of ${op.fullName}’s zones.`);
  need(h.kindsForArea(areaId).includes(kind), `${WORK_LABEL[kind]} is not done in ${h.areaName(areaId)}.`);
  const n = input.bottlesHandled;
  need(Number.isInteger(n) && n > 0, 'Enter the number of bottles, more than 0.');

  const now = new Date();
  const entry: Prisma.ProductionEntryUncheckedCreateInput = {
    assignId: line?.assignId ?? null, operatorId: op.userId, kind, source: 'MANUAL', areaId, workDate: dbDate(input.workDate),
    bottlesHandled: n, bottlesProduced: 0, bottlesLost: 0, status: isOp ? 'PENDING' : 'VERIFIED',
    verifiedBy: isOp ? null : me.userId, verifiedAt: isOp ? null : now, note: (input.note ?? '').trim().slice(0, 500), enteredBy: me.userId,
  };

  if (kind === 'SUBCULTURE') {
    const stageId = line?.stageId ?? (input.stageCode !== undefined ? h.stageByCode(input.stageCode).stageId : input.stageId) ?? null;
    need(stageId, 'Type the stage.');
    let batchId = line?.batchId ?? input.batchId ?? null;
    if (!line && input.batchCode !== undefined) {
      const f = h.findBatch(input.batchCode);
      if (f) {
        need(f.status === 'RUNNING', `Batch ${f.batchCode} is closed.`);
        batchId = f.batchId;
      } else {
        const code = input.batchCode.trim().toUpperCase().replace(/\s+/g, '');
        need(code.length >= 2 && code.length <= 20, 'Type the batch code, for example B1-26.');
        need(c.crops.some((x) => x.cropId === input.cropId), `Batch ${code} is new. Choose its crop so it can be added.`);
        // If anything below fails, the whole change is rolled back, so the new batch is not kept.
        batchId = (await addBatch(tx, c, code, input.cropId!, input.workDate)).batchId;
      }
    }
    need(batchId, 'Type the batch code.');
    const r = await subcultureByCount(tx, c, me, {
      batchId, stageId, bottlesHandled: n, bottlesOut: input.bottlesOut ?? 0, bottlesLost: input.bottlesLost ?? 0,
      toStageId: input.toStageId ?? stageId, toBenchId: input.toBenchId ?? 0, mediaLotId: input.mediaLotId ?? null, cause: input.cause, contType: input.contType,
    }, input.workDate);
    Object.assign(entry, {
      batchId, stageId, taken: r.taken, movementId: r.movementId, contId: r.contId, mediaLotId: input.mediaLotId ?? null,
      bottlesProduced: input.bottlesOut ?? 0, bottlesLost: input.bottlesLost ?? 0,
    });
  } else if (kind === 'WASH') {
    const cont = input.contaminated ?? 0;
    need(Number.isInteger(cont) && cont >= 0 && cont <= n, 'Contaminated bottles must be between 0 and the bottles washed.');
    const pool = h.washPool();
    need(n - cont <= pool.plain, `Only ${pool.plain} bottles are waiting to be washed.`);
    need(cont <= pool.contaminated, `Only ${pool.contaminated} contaminated bottles are waiting to be washed.`);
    entry.contaminated = cont;
  } else if (kind === 'MEDIA') {
    const recipeId = line?.recipeId ?? input.recipeId;
    const recipe = c.recipes.find((r) => r.recipeId === recipeId);
    need(recipe, 'Choose the media code.');
    const code = (line?.mediaBatchCode ?? input.mediaBatchCode ?? '').trim() || h.nextMediaBatchCode(input.workDate);
    need(code.length <= 20, 'The media batch code is too long.');
    const lot = c.lots.find((l) => l.lotCode.toLowerCase() === code.toLowerCase());
    need(!lot || lot.recipeId === recipe.recipeId, `Batch code ${code} is already used for ${h.recipeCode(lot?.recipeId)} media.`);
    const litres = input.litres ?? 0;
    need(litres >= 0 && litres <= 10_000, 'Litres must be 0 or more.');
    const saved = lot
      ? await tx.mediaLot.update({ where: { mediaLotId: lot.mediaLotId }, data: { bottlesFilled: { increment: n }, volumeLitre: Math.round((lot.volumeLitre + litres) * 100) / 100 } })
      : await tx.mediaLot.create({
        data: {
          lotCode: code, recipeId: recipe.recipeId, preparedOn: dbDate(input.workDate), volumeLitre: litres, bottlesFilled: n,
          expiresOn: dbDate(addDays(input.workDate, recipe.shelfLifeDays)), preparedBy: op.userId,
        },
      });
    entry.mediaLotId = saved.mediaLotId;
    entry.bottlesProduced = n;
  } else {
    const failed = input.bottlesLost ?? 0;
    need(Number.isInteger(failed) && failed >= 0 && failed <= n, 'Bottles that failed must be between 0 and the bottles checked.');
    entry.bottlesLost = failed;
  }
  const saved = await tx.productionEntry.create({ data: entry });
  const mem: Ent = {
    ...saved, taken: (saved.taken as Taken[] | null) ?? null, workDate: isoDate(saved.workDate), enteredAt: saved.enteredAt.toISOString(), verifiedAt: saved.verifiedAt?.toISOString() ?? null,
  };
  c.ents.push(mem);
  return mem;
}

interface CountSubculture {
  batchId: number;
  stageId: number;
  bottlesHandled: number;
  bottlesOut: number;
  bottlesLost: number;
  toStageId: number;
  toBenchId: number;
  mediaLotId: number | null;
  cause?: LossCause;
  contType?: LossType;
}

/**
 * Sub-culture typed in by hand. Bottles are taken from that batch and stage's trays, oldest first
 * (a tray partly used keeps the rest), new trays are made for the new bottles, and any loss is recorded.
 */
async function subcultureByCount(tx: Db, c: Ctx, me: Me, input: CountSubculture, date: string) {
  const h = helpers(c);
  const from = h.stageOf(input.stageId);
  const to = h.stageOf(input.toStageId);
  const batch = c.batches.find((b) => b.batchId === input.batchId);
  need(batch && batch.status === 'RUNNING', 'Choose a running batch.');
  need(from, 'Choose the stage the bottles were at.');
  need(to, 'Choose the stage the new bottles go to.');
  need(to.seqNo >= from.seqNo, 'Bottles cannot go back to an earlier stage.');
  need(h.benchOf(input.toBenchId), 'Choose a bench or rack for the new bottles.');
  const { bottlesHandled: n, bottlesOut: out, bottlesLost: lost } = input;
  need([n, out, lost].every((x) => Number.isInteger(x) && x >= 0), 'Bottle counts must be whole numbers, 0 or more.');
  need(n > 0, 'Enter the bottles handled.');
  const trays = h.traysFor(input.batchId, input.stageId, me);
  const have = trays.reduce((k, t) => k + t.bottleCount, 0);
  // Nothing recorded yet for this batch and stage (a batch the lab started before using the app):
  // the work is still recorded and its new bottles become the first trays in the system.
  const untracked = !c.trays.some((t) => t.batchId === input.batchId && t.stageId === input.stageId && t.status === 'ACTIVE' && t.bottleCount > 0);
  if (!untracked) {
    need(have > 0, `The ${batch.batchCode} trays at ${from.code} are in another zone. Ask your supervisor.`);
    need(n <= have, `${batch.batchCode} has only ${have} bottles at ${from.code} recorded in your zones. Check the count.`);
  }
  need(lost <= n, 'Lost bottles cannot be more than bottles handled.');
  need(out > 0 || lost === n, 'Enter the new bottles made, or mark all bottles as lost.');
  const maxOut = (n - lost) * MAX_GROWTH;
  need(out <= maxOut, `${out} new bottles from ${n - lost} good bottles is more than ${MAX_GROWTH} times. Check the count (at most ${maxOut}).`);
  if (lost > 0) need(input.cause && input.contType, 'Choose the cause and type of the loss.');
  await checkLot(tx, input.mediaLotId, to, out);

  // Take bottles from the oldest trays first.
  const taken: Taken[] = [];
  let left = n;
  for (const t of trays) {
    if (left <= 0) break;
    const k = Math.min(left, t.bottleCount);
    taken.push({ trayId: t.trayId, bottles: k });
    const rest = t.bottleCount - k;
    await updateTray(tx, t, { bottleCount: rest, ...(rest === 0 ? { status: 'MOVED' as const } : {}) });
    t.bottleCount = rest;
    t.version += 1;
    if (rest === 0) t.status = 'MOVED';
    left -= k;
  }
  const made = out > 0 ? await makeTrays(tx, batch, to.stageId, input.toBenchId, out, input.mediaLotId) : [];
  for (const t of made) c.trays.push({ ...t, placedOn: isoDate(t.placedOn) });
  // The loss is recorded against the first tray the bottles came from (or, if none were recorded, the first new tray).
  const first = taken.length ? c.trays.find((t) => t.trayId === taken[0].trayId)! : made[0];
  let contId: number | null = null;
  if (lost > 0 && first) {
    const cont = await tx.contamination.create({
      data: { trayId: first.trayId, bottlesLost: lost, cause: input.cause!, contType: input.contType!, foundOn: dbDate(date), reportedBy: me.userId, note: 'Found at sub-culture (typed in)' },
    });
    contId = cont.contId;
    c.conts.push({ ...cont, foundOn: date });
  }
  // Work for an earlier day is dated that day (17:00 lab time, i.e. 11:30 UTC in India), so day totals stay right.
  const movedAt = date === today() ? new Date() : new Date(`${date}T11:30:00Z`);
  const move = await tx.trayMovement.create({
    data: {
      batchId: batch.batchId, trayId: first?.trayId ?? null, newTrayIds: made.map((m) => m.trayId), takenTrayIds: taken.map((x) => x.trayId),
      fromStageId: from.stageId, toStageId: to.stageId, fromBenchId: first?.benchId ?? input.toBenchId, toBenchId: input.toBenchId,
      bottlesIn: n, bottlesOut: out, bottlesLost: lost, movedBy: me.userId, movedAt,
    },
  });
  c.movs.push({ ...move, movedAt: move.movedAt.toISOString(), movedDate: labDate(move.movedAt) });
  return { made, taken, movementId: move.movementId, contId, untracked };
}

export async function verifyEntries(tx: Db, c: Ctx, me: Me, entryIds: number[]) {
  const h = helpers(c);
  need(entryIds.length > 0, 'Choose at least one entry.');
  for (const id of entryIds) {
    const e = c.ents.find((x) => x.entryId === id);
    need(e, 'Entry not found.', 404);
    need(h.inCharge(me, e.operatorId), `${h.nameOf(e.operatorId)} is not in your zones.`, 403);
    need(e.status === 'PENDING', 'Only entries waiting for a check can be verified.', 409);
  }
  await tx.productionEntry.updateMany({ where: { entryId: { in: entryIds } }, data: { status: 'VERIFIED', verifiedBy: me.userId, verifiedAt: new Date() } });
}

/**
 * Sends an entry back. When nothing has used what it made, it is also undone:
 * a sub-culture's new trays are removed and the bottles go back to their trays; media bottles come off their lot.
 */
export async function rejectEntry(tx: Db, c: Ctx, me: Me, entryId: number, reason: string) {
  const h = helpers(c);
  const e = c.ents.find((x) => x.entryId === entryId);
  need(e, 'Entry not found.', 404);
  need(h.inCharge(me, e.operatorId), `${h.nameOf(e.operatorId)} is not in your zones.`, 403);
  need(e.status === 'PENDING', 'Only entries waiting for a check can be sent back.', 409);
  need(reason.trim().length >= 3, 'Write the reason, so the operator knows what to fix.');
  const undone = h.canUndo(e);
  const unlink: Prisma.ProductionEntryUncheckedUpdateInput = {};
  if (undone && e.kind === 'SUBCULTURE') {
    const m = h.movementOf(e.movementId)!;
    unlink.movementId = null;
    unlink.contId = null;
    await tx.productionEntry.update({ where: { entryId }, data: unlink });
    if (e.contId !== null) await tx.contamination.delete({ where: { contId: e.contId } });
    await tx.trayMovement.delete({ where: { movementId: m.movementId } });
    await tx.tray.deleteMany({ where: { trayId: { in: m.newTrayIds } } });
    if (e.taken) {
      for (const x of e.taken) await tx.tray.update({ where: { trayId: x.trayId }, data: { bottleCount: { increment: x.bottles }, status: 'ACTIVE', version: { increment: 1 } } });
    } else if (e.trayId !== null) {
      await tx.tray.update({ where: { trayId: e.trayId }, data: { status: 'ACTIVE', version: { increment: 1 } } });
    }
  } else if (undone && e.kind === 'MEDIA' && e.mediaLotId !== null) {
    const lot = c.lots.find((l) => l.mediaLotId === e.mediaLotId)!;
    const leftover = lot.bottlesFilled - e.bottlesHandled;
    const others = c.ents.some((x) => x.entryId !== e.entryId && x.mediaLotId === lot.mediaLotId && live(x));
    const stock = await tx.stockTxn.count({ where: { mediaLotId: lot.mediaLotId } });
    if (leftover <= 0 && !others && !stock) {
      await tx.productionEntry.update({ where: { entryId }, data: { mediaLotId: null } });
      await tx.mediaLot.delete({ where: { mediaLotId: lot.mediaLotId } });
    } else {
      await tx.mediaLot.update({ where: { mediaLotId: lot.mediaLotId }, data: { bottlesFilled: Math.max(0, leftover) } });
    }
  }
  await tx.productionEntry.update({ where: { entryId }, data: { status: 'REJECTED', verifiedBy: me.userId, verifiedAt: new Date(), note: reason.trim().slice(0, 500) } });
  return { undone: undone && (e.kind === 'SUBCULTURE' || e.kind === 'MEDIA') };
}
