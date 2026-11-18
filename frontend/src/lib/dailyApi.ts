// FAKE API, daily-work part: attendance, work given to operators, work done (scanned or typed in),
// checking entries, and the output totals.
// Scope: manager sees every operator; a supervisor sees operators who work in any zone they look after;
// an operator sees only their own records.
import { addDays, copy, need, today, wait } from './apiUtil';
import { ensureBatch, stageByCode, subcultureByCount, traysFor, visibleAreas, type CountSubcultureInput } from './productionApi';
import { db, nextId, save } from './store';
import type { AreaType, Attendance, AttStatus, Bench, EntryStatus, LossCause, LossType, ProductionEntry, User, WorkAssignment, WorkKind } from './types';
import { WORK_LABEL } from './types';
import {
  assignArea, entryArea, entryBatch, entryStage, isHood, kindOf, kindsForArea, liveEntry as live, MAX_PER_HOOD, mediaStatus,
  nextMediaBatchCode, targetOf, washAddedOn, washPool, workZones,
} from './work';

// ---------- helpers ----------
const nameOf = (id: number | null | undefined) => db.users.find((u) => u.userId === id)?.fullName ?? '—';
const stageCode = (id: number | null) => db.stages.find((s) => s.stageId === id)?.code ?? '—';
const batchCode = (id: number | null) => db.batches.find((b) => b.batchId === id)?.batchCode ?? '—';
const benchCode = (id: number | null) => db.benches.find((b) => b.benchId === id)?.code ?? '—';
const areaName = (id: number | null) => db.areas.find((a) => a.areaId === id)?.name ?? '—';
const recipeCode = (id: number | null | undefined) => db.recipes.find((r) => r.recipeId === id)?.code ?? '—';
const userOf = (id: number) => db.users.find((u) => u.userId === id);

/** Zones of this operator that the user looks after (all of them for the manager). */
function sharedZones(user: User, op: User): number[] {
  const areas = visibleAreas(user);
  return workZones(op).filter((z) => user.role === 'MANAGER' || areas === null || areas.includes(z));
}
/** Active operators the user is in charge of: anyone who works in at least one of the user's zones. */
function myOperators(user: User): User[] {
  need(user.role !== 'OPERATOR', 'Only a supervisor or manager can do this.');
  return db.users.filter((u) => u.role === 'OPERATOR' && u.status === 'ACTIVE' && sharedZones(user, u).length > 0);
}
const inCharge = (user: User, operatorId: number) => myOperators(user).some((u) => u.userId === operatorId);
const attOf = (userId: number, date: string) => db.attendance.find((a) => a.userId === userId && a.workDate === date)?.status ?? null;

/** How far below target counts as a warning or critical, from the LOW_OUTPUT alert rule. */
export type Level = 'NONE' | 'OK' | 'WARNING' | 'CRITICAL';
function outputLevel(pct: number | null, date: string): Level {
  // Today is still in progress, so it is not judged until the day is over.
  if (pct === null || date >= today()) return 'NONE';
  const r = db.alertRules.find((x) => x.code === 'LOW_OUTPUT');
  if (!r) return 'OK';
  if (r.criticalValue !== null && pct < r.criticalValue) return 'CRITICAL';
  return pct < r.warnValue ? 'WARNING' : 'OK';
}
const pctOf = (done: number, target: number) => (target > 0 ? Math.round((100 * done) / target) : null);

/** Short name of a line of work, e.g. "B1-26 · M6", "Washing", "MU-01 · B0003/26", "Culture quality check". */
export function workLabel(a: Pick<WorkAssignment, 'batchId' | 'stageId' | 'recipeId' | 'mediaBatchCode'> & { kind?: WorkKind }): string {
  const k = kindOf(a);
  if (k === 'SUBCULTURE') return `${batchCode(a.batchId)} · ${stageCode(a.stageId)}`;
  if (k === 'MEDIA') return `${recipeCode(a.recipeId)}${a.mediaBatchCode ? ` · ${a.mediaBatchCode}` : ''}`;
  return WORK_LABEL[k];
}

const runningBatches = () => db.batches.filter((b) => b.status === 'RUNNING').map((b) => ({ batchId: b.batchId, batchCode: b.batchCode })).sort((a, b) => a.batchCode.localeCompare(b.batchCode));
const cropList = () => db.crops.map((c) => ({ cropId: c.cropId, name: `${c.name} ${c.variety}` }));
const findBatch = (code: string) => db.batches.find((b) => b.batchCode.toUpperCase() === code.trim().toUpperCase().replace(/\s+/g, ''));

// ---------- shapes returned to pages ----------
export interface AttendanceRow {
  userId: number;
  fullName: string;
  areaName: string;
  status: AttStatus | null;
  markedByName: string | null;
}

export interface AssignmentRow extends WorkAssignment {
  kind: WorkKind;
  areaId: number | null;
  areaName: string;
  operatorName: string;
  label: string;
  batchCode: string;
  stageCode: string;
  benchCode: string;
  recipeCode: string;
  /** Whole target of the line (washing: plain + contaminated). */
  target: number;
  handled: number;
  produced: number;
  lost: number;
  /** Washing: contaminated bottles washed so far. */
  contaminated: number;
  entries: number;
  pending: number;
  pct: number | null;
  level: Level;
  /** Once the day is over: bottles not done. They were never taken out, so they stay where they were. */
  returned: number;
  returnedTo: string;
}

export interface BoardRow {
  operatorId: number;
  fullName: string;
  areaName: string;
  attendance: AttStatus | null;
  work: string[];
  target: number;
  handled: number;
  produced: number;
  lost: number;
  pending: number;
  pct: number | null;
  level: Level;
}

export interface EntryRow extends ProductionEntry {
  kind: WorkKind;
  source: 'QR' | 'MANUAL';
  operatorName: string;
  /** Tray code for a scan; "Typed in" otherwise. */
  qrCode: string;
  label: string;
  batchCode: string;
  stageCode: string;
  areaName: string;
  verifiedByName: string | null;
  enteredByName: string | null;
  /** True when the entry has no matching work assignment (operator did work not given to them). */
  unassigned: boolean;
  /** True when sending it back can also undo what it changed (trays, media lot). */
  undoable: boolean;
}

export interface ZoneOption {
  areaId: number;
  name: string;
  areaType: AreaType;
  kinds: WorkKind[];
}

export interface AssignOptions {
  operators: { userId: number; fullName: string; areaId: number | null; zones: ZoneOption[]; attendance: AttStatus | null }[];
  batches: { batchId: number; batchCode: string; stages: { stageId: number; code: string; bottles: number; trays: number; free: number }[] }[];
  /** Benches, with who already works at each one on that day (for the 2-per-hood rule). */
  benches: (Bench & { areaName: string; hood: boolean; operatorIds: number[] })[];
  /** Washing: bottles waiting at the wash area, and how many are already given out on that day. */
  wash: { plain: number; contaminated: number; givenPlain: number; givenContaminated: number; addedPlain: number; addedContaminated: number };
  /** Media: bottles ready for each media code, the codes, and the next free media batch code. */
  media: { recipeId: number; code: string; bottles: number; lots: number }[];
  nextMediaBatchCode: string;
  maxPerHood: number;
  /** For the typed batch and stage boxes: every running batch, every stage, and the crops a new batch can be. */
  allBatches: { batchId: number; batchCode: string }[];
  stageCodes: string[];
  crops: { cropId: number; name: string }[];
}

/** Batch and stage as typed by the user. A batch not in the app yet is added (it needs its crop). */
export interface TypedBatch {
  batchCode?: string;
  stageCode?: string;
  cropId?: number | null;
}

export interface AssignInput extends TypedBatch {
  assignId?: number;
  workDate: string;
  operatorId: number;
  kind?: WorkKind;
  areaId?: number | null;
  batchId: number | null;
  stageId: number | null;
  benchId: number | null;
  targetBottles: number;
  targetContaminated?: number;
  recipeId?: number | null;
  mediaBatchCode?: string;
}

/** Work done, typed in by hand by the operator, or by the supervisor for the operator. */
export interface WorkInput extends TypedBatch {
  operatorId: number;
  workDate: string;
  /** The line of work this is for (optional: picked automatically when it matches). */
  assignId?: number | null;
  kind: WorkKind;
  areaId?: number | null;
  /** Bottles sub-cultured / washed / made / checked. */
  bottlesHandled: number;
  // sub-culture
  batchId?: number | null;
  stageId?: number | null;
  bottlesOut?: number;
  bottlesLost?: number;
  toStageId?: number;
  toBenchId?: number;
  mediaLotId?: number | null;
  cause?: LossCause;
  contType?: LossType;
  // washing: of the bottles washed, how many were contaminated
  contaminated?: number;
  // media making
  recipeId?: number | null;
  mediaBatchCode?: string;
  litres?: number;
  // quality check: bottles that failed (use bottlesLost)
  note?: string;
}

export interface EntryOptions {
  operator: { userId: number; fullName: string; attendance: AttStatus | null };
  /** Work given to the operator that day (in zones the user can see). */
  lines: AssignmentRow[];
  zones: ZoneOption[];
  /** Batches with bottles that can be taken, by stage; benchId is where the oldest tray sits. */
  batches: { batchId: number; batchCode: string; growth: number; stages: { stageId: number; code: string; bottles: number; trays: number; benchId: number | null }[] }[];
  stages: { stageId: number; code: string; phase: string; seqNo: number }[];
  /** Benches and racks the new trays can go on. */
  benches: { benchId: number; code: string; areaName: string; capacity: number; trays: number }[];
  wash: { plain: number; contaminated: number };
  media: { recipeId: number; code: string; bottles: number; lots: number }[];
  nextMediaBatchCode: string;
  allBatches: { batchId: number; batchCode: string }[];
  crops: { cropId: number; name: string }[];
}

export interface DayOutput {
  workDate: string;
  attendance: AttStatus | null;
  target: number;
  handled: number;
  produced: number;
  lost: number;
  pending: number;
  verified: number;
  pct: number | null;
  level: Level;
}

/** Filters for the output page. Every field is optional. */
export interface OutputFilter {
  from: string;
  to: string;
  operatorId?: number | null;
  areaId?: number | null;
  kind?: WorkKind | null;
  batchId?: number | null;
  stageId?: number | null;
}

export interface OutputGroup {
  key: string;
  label: string;
  /** What the row filters on when clicked. */
  filter: Partial<OutputFilter>;
  target: number;
  handled: number;
  produced: number;
  lost: number;
  entries: number;
  pct: number | null;
}

export interface WorkOutput {
  totals: { target: number; handled: number; produced: number; lost: number; entries: number; pending: number; operators: number; days: number };
  byDay: (OutputGroup & { date: string })[];
  byOperator: OutputGroup[];
  byZone: OutputGroup[];
  byKind: OutputGroup[];
  byBatch: OutputGroup[];
  byStage: OutputGroup[];
  entries: EntryRow[];
  options: {
    operators: { userId: number; fullName: string }[];
    zones: { areaId: number; name: string }[];
    batches: { batchId: number; batchCode: string }[];
    stages: { stageId: number; code: string }[];
    kinds: WorkKind[];
  };
}

function assignmentRow(a: WorkAssignment): AssignmentRow {
  const es = db.entries.filter((e) => e.assignId === a.assignId && live(e));
  const handled = es.reduce((n, e) => n + e.bottlesHandled, 0);
  const target = targetOf(a);
  const pct = pctOf(handled, target);
  const k = kindOf(a);
  const over = a.workDate < today();
  const returned = over ? Math.max(0, target - handled) : 0;
  const areaId = assignArea(a);
  return {
    ...copy(a),
    kind: k,
    areaId,
    areaName: areaName(areaId),
    operatorName: nameOf(a.operatorId),
    label: workLabel(a),
    batchCode: batchCode(a.batchId),
    stageCode: stageCode(a.stageId),
    benchCode: benchCode(a.benchId),
    recipeCode: recipeCode(a.recipeId),
    target,
    handled,
    produced: es.reduce((n, e) => n + e.bottlesProduced, 0),
    lost: es.reduce((n, e) => n + e.bottlesLost, 0),
    contaminated: es.reduce((n, e) => n + (e.contaminated ?? 0), 0),
    entries: es.length,
    pending: es.filter((e) => e.status === 'PENDING').length,
    pct,
    level: outputLevel(pct, a.workDate),
    returned,
    returnedTo:
      k === 'SUBCULTURE' ? `stay in the ${batchCode(a.batchId)} · ${stageCode(a.stageId)} trays`
        : k === 'WASH' ? 'stay in the wash area count'
          : k === 'MEDIA' ? 'were not made' : 'were not checked',
  };
}

const movementOf = (id: number | null) => (id === null ? undefined : db.movements.find((x) => x.movementId === id));
/** True when nothing has touched the new trays (and, for typed-in work, the trays bottles were taken from) since. */
function traysUntouched(e: ProductionEntry): boolean {
  const m = movementOf(e.movementId);
  if (!m) return false;
  const made = db.trays.filter((t) => m.newTrayIds.includes(t.trayId));
  if (made.length !== m.newTrayIds.length || made.some((t) => t.status !== 'ACTIVE' || t.bottleCount !== (t.startBottles ?? t.bottleCount))) return false;
  if (db.movements.some((x) => x.movementId !== m.movementId && (m.newTrayIds.includes(x.trayId) || x.takenTrayIds?.some((id) => m.newTrayIds.includes(id))))) return false;
  if (db.contaminations.some((c) => m.newTrayIds.includes(c.trayId))) return false;
  const source = e.taken?.map((x) => x.trayId) ?? (e.trayId !== null ? [e.trayId] : []);
  if (db.movements.some((x) => x.movementId > m.movementId && (source.includes(x.trayId) || x.takenTrayIds?.some((id) => source.includes(id))))) return false;
  return true;
}

/** A sent-back entry can be undone only if nothing has used what it made. */
function canUndo(e: ProductionEntry): boolean {
  if (e.status === 'REJECTED') return false;
  const k = kindOf(e);
  if (k === 'SUBCULTURE') {
    if (!traysUntouched(e)) return false;
    if (e.taken) return true;
    const old = db.trays.find((t) => t.trayId === e.trayId);
    return !!old && old.status !== 'ACTIVE';
  }
  if (k === 'MEDIA') {
    const lot = db.mediaLots.find((l) => l.mediaLotId === e.mediaLotId);
    if (!lot) return false;
    const used = db.trays.filter((t) => t.mediaLotId === lot.mediaLotId).reduce((n, t) => n + (t.startBottles ?? t.bottleCount), 0);
    return lot.bottlesFilled - used >= e.bottlesHandled;
  }
  // Washing and checks change no stock: sending back simply stops them counting.
  return true;
}

function entryRow(e: ProductionEntry): EntryRow {
  const t = e.trayId !== null ? db.trays.find((x) => x.trayId === e.trayId) : undefined;
  const k = kindOf(e);
  const b = entryBatch(e);
  const s = entryStage(e);
  const lot = e.mediaLotId ? db.mediaLots.find((l) => l.mediaLotId === e.mediaLotId) : undefined;
  return {
    ...copy(e),
    kind: k,
    source: e.source ?? (e.trayId !== null ? 'QR' : 'MANUAL'),
    operatorName: nameOf(e.operatorId),
    qrCode: t?.qrCode ?? (e.taken ? `${e.taken.length} tray${e.taken.length === 1 ? '' : 's'}` : 'Typed in'),
    label: k === 'SUBCULTURE' ? `${batchCode(b)} · ${stageCode(s)}` : k === 'MEDIA' ? `${recipeCode(lot?.recipeId)}${lot ? ` · ${lot.lotCode}` : ''}` : WORK_LABEL[k],
    batchCode: batchCode(b),
    stageCode: stageCode(s),
    areaName: areaName(entryArea(e)),
    verifiedByName: e.verifiedBy ? nameOf(e.verifiedBy) : null,
    enteredByName: e.enteredBy && e.enteredBy !== e.operatorId ? nameOf(e.enteredBy) : null,
    unassigned: e.assignId === null,
    undoable: canUndo(e),
  };
}

/** Lines of the same kind of work the operator already has that day (to stop the same line twice). */
function sameLine(a: AssignInput, b: WorkAssignment): boolean {
  if (b.workDate !== a.workDate || b.operatorId !== a.operatorId || kindOf(b) !== (a.kind ?? 'SUBCULTURE') || b.assignId === a.assignId) return false;
  const k = a.kind ?? 'SUBCULTURE';
  if (k === 'SUBCULTURE') return b.batchId === a.batchId && b.stageId === a.stageId;
  if (k === 'MEDIA') return b.recipeId === a.recipeId && (b.mediaBatchCode ?? '') === (a.mediaBatchCode ?? '').trim();
  return true;
}

export const dailyApi = {
  // ---------- attendance ----------
  async getAttendance(date: string, user: User): Promise<AttendanceRow[]> {
    await wait();
    return myOperators(user).map((u) => {
      const a = db.attendance.find((x) => x.userId === u.userId && x.workDate === date);
      return { userId: u.userId, fullName: u.fullName, areaName: workZones(u).map(areaName).join(', '), status: a?.status ?? null, markedByName: a ? nameOf(a.markedBy) : null };
    }).sort((a, b) => a.areaName.localeCompare(b.areaName) || a.fullName.localeCompare(b.fullName));
  },

  async markAttendance(date: string, marks: { userId: number; status: AttStatus }[], user: User): Promise<void> {
    await wait();
    need(date <= today(), 'Attendance cannot be marked for a future date.');
    need(date >= addDays(today(), -7), 'Attendance older than 7 days cannot be changed.');
    for (const m of marks) {
      need(inCharge(user, m.userId), `${nameOf(m.userId)} is not in your zones.`);
      if (m.status === 'A') {
        const started = db.entries.some((e) => e.operatorId === m.userId && e.workDate === date && live(e));
        need(!started, `${nameOf(m.userId)} already has work entries on this day, so cannot be marked absent.`);
      }
      const row = db.attendance.find((a) => a.userId === m.userId && a.workDate === date);
      if (row) {
        row.status = m.status;
        row.markedBy = user.userId;
      } else db.attendance.push({ attId: nextId(db.attendance, 'attId'), userId: m.userId, workDate: date, status: m.status, markedBy: user.userId });
    }
    save();
  },

  /** An operator's own attendance for one month (YYYY-MM). */
  async myAttendance(user: User, month: string): Promise<Attendance[]> {
    await wait();
    return copy(db.attendance.filter((a) => a.userId === user.userId && a.workDate.startsWith(month)));
  },

  // ---------- work assignments ----------
  async assignOptions(date: string, user: User): Promise<AssignOptions> {
    await wait();
    const areas = visibleAreas(user);
    const ops = user.role === 'OPERATOR' ? [user] : myOperators(user);
    const inScope = (benchId: number) => {
      const a = db.benches.find((b) => b.benchId === benchId)?.areaId ?? null;
      return areas === null || (a !== null && areas.includes(a));
    };
    const stages = [...db.stages].sort((a, b) => a.seqNo - b.seqNo);
    const day = db.assignments.filter((a) => a.workDate === date);
    const taken = (batchId: number, stageId: number) =>
      day.filter((a) => kindOf(a) === 'SUBCULTURE' && a.batchId === batchId && a.stageId === stageId).reduce((n, a) => n + a.targetBottles, 0);
    const batches = db.batches
      .filter((b) => b.status === 'RUNNING')
      .map((b) => {
        const ts = db.trays.filter((t) => t.batchId === b.batchId && t.status === 'ACTIVE' && inScope(t.benchId));
        return {
          batchId: b.batchId,
          batchCode: b.batchCode,
          stages: stages
            .map((s) => {
              const st = ts.filter((t) => t.stageId === s.stageId);
              const bottles = st.reduce((n, t) => n + t.bottleCount, 0);
              return { stageId: s.stageId, code: s.code, bottles, trays: st.length, free: Math.max(0, bottles - taken(b.batchId, s.stageId)) };
            })
            .filter((s) => s.trays > 0),
        };
      })
      .filter((b) => b.stages.length > 0);
    const zoneOpt = (id: number): ZoneOption | null => {
      const a = db.areas.find((x) => x.areaId === id);
      return a ? { areaId: a.areaId, name: a.name, areaType: a.areaType, kinds: kindsForArea(a.areaId) } : null;
    };
    const opZones = new Set(ops.flatMap((o) => (user.role === 'OPERATOR' ? workZones(o) : sharedZones(user, o))));
    const pool = washPool();
    const washLines = day.filter((a) => kindOf(a) === 'WASH');
    return {
      operators: ops.map((o) => ({
        userId: o.userId, fullName: o.fullName, areaId: o.homeAreaId,
        zones: (user.role === 'OPERATOR' ? workZones(o) : sharedZones(user, o)).map(zoneOpt).filter((z): z is ZoneOption => z !== null),
        attendance: attOf(o.userId, date),
      })),
      batches,
      benches: db.benches.filter((b) => opZones.has(b.areaId)).map((b) => ({
        ...copy(b), areaName: areaName(b.areaId), hood: isHood(b.benchId),
        operatorIds: [...new Set(day.filter((a) => a.benchId === b.benchId).map((a) => a.operatorId))],
      })),
      wash: {
        plain: pool.plain, contaminated: pool.contaminated,
        givenPlain: washLines.reduce((n, a) => n + a.targetBottles, 0),
        givenContaminated: washLines.reduce((n, a) => n + (a.targetContaminated ?? 0), 0),
        addedPlain: washAddedOn(date).plain,
        addedContaminated: washAddedOn(date).contaminated,
      },
      media: mediaStatus(),
      nextMediaBatchCode: nextMediaBatchCode(date),
      maxPerHood: MAX_PER_HOOD,
      allBatches: runningBatches(),
      stageCodes: stages.map((s) => s.code),
      crops: cropList(),
    };
  },

  async listAssignments(date: string, user: User): Promise<AssignmentRow[]> {
    await wait();
    const ids = new Set(user.role === 'OPERATOR' ? [user.userId] : myOperators(user).map((u) => u.userId));
    const areas = visibleAreas(user);
    return db.assignments
      .filter((a) => a.workDate === date && ids.has(a.operatorId))
      .map(assignmentRow)
      // A supervisor sees only the lines in their own zones (an operator in two zones may also have work from another supervisor).
      .filter((a) => user.role !== 'SUPERVISOR' || areas === null || (a.areaId !== null && areas.includes(a.areaId)))
      .sort((a, b) => a.operatorName.localeCompare(b.operatorName));
  },

  async saveAssignment(input: AssignInput, user: User): Promise<WorkAssignment> {
    await wait();
    const kind: WorkKind = input.kind ?? 'SUBCULTURE';
    need(input.workDate >= today(), 'Work can only be given for today or a later date.');
    need(inCharge(user, input.operatorId), 'This operator is not in your zones.');
    need(attOf(input.operatorId, input.workDate) !== 'A', `${nameOf(input.operatorId)} is marked absent on this day.`);
    const op = userOf(input.operatorId)!;
    const zones = sharedZones(user, op);
    const areaId = input.areaId ?? zones[0] ?? null;
    need(areaId !== null && zones.includes(areaId), `Choose one of ${op.fullName}’s zones that you look after.`);
    need(kindsForArea(areaId).includes(kind), `${WORK_LABEL[kind]} is not done in ${areaName(areaId)}.`);
    const whole = (x: number | undefined) => x === undefined || (Number.isInteger(x) && x >= 0);
    need(whole(input.targetBottles) && whole(input.targetContaminated), 'Targets must be whole numbers of bottles.');
    const old = input.assignId ? db.assignments.find((a) => a.assignId === input.assignId) : undefined;
    const opts = await dailyApi.assignOptions(input.workDate, user);
    const row: Omit<WorkAssignment, 'assignId' | 'assignedBy'> = {
      workDate: input.workDate, operatorId: input.operatorId, kind, areaId, batchId: null, stageId: null,
      benchId: input.benchId, targetBottles: input.targetBottles,
    };

    // A typed batch that is not in the app yet is added only once everything else checks out.
    let newBatch: { code: string; cropId: number | null | undefined } | null = null;
    if (kind === 'SUBCULTURE') {
      need(input.targetBottles > 0, 'Target must be more than 0 bottles.');
      let batchId = input.batchId;
      let stageId = input.stageId;
      if (input.stageCode !== undefined) stageId = stageByCode(input.stageCode).stageId;
      if (input.batchCode !== undefined) {
        const f = findBatch(input.batchCode);
        if (f) {
          need(f.status === 'RUNNING', `Batch ${f.batchCode} is closed.`);
          batchId = f.batchId;
        } else {
          need(db.crops.some((c) => c.cropId === input.cropId), `Batch ${input.batchCode.trim().toUpperCase()} is new. Choose its crop so it can be added.`);
          newBatch = { code: input.batchCode, cropId: input.cropId };
          batchId = null;
        }
      }
      need(newBatch || batchId, 'Type the batch code.');
      need(stageId, 'Type the stage.');
      const recorded = batchId !== null && db.trays.some((t) => t.batchId === batchId && t.stageId === stageId && t.status === 'ACTIVE' && t.bottleCount > 0);
      if (recorded) {
        // Bottles are in the app: the target cannot be more than what is not yet given out.
        const st = opts.batches.find((b) => b.batchId === batchId)?.stages.find((s) => s.stageId === stageId);
        need(st, `The ${batchCode(batchId)} trays at ${stageCode(stageId)} are not in your zones.`);
        const free = st!.free + (old && kindOf(old) === 'SUBCULTURE' && old.batchId === batchId && old.stageId === stageId ? old.targetBottles : 0);
        need(input.targetBottles <= free, `Only ${free} bottles of ${batchCode(batchId)} at ${st!.code} are left to give out on this day.`);
      }
      row.batchId = batchId;
      row.stageId = stageId;
    } else if (kind === 'WASH') {
      const tc = input.targetContaminated ?? 0;
      need(input.targetBottles + tc > 0, 'Give a target for bottles to wash, contaminated bottles to wash, or both.');
      const mine = old && kindOf(old) === 'WASH' ? old : undefined;
      const freePlain = opts.wash.plain - opts.wash.givenPlain + (mine?.targetBottles ?? 0);
      const freeCont = opts.wash.contaminated - opts.wash.givenContaminated + (mine?.targetContaminated ?? 0);
      need(input.targetBottles <= Math.max(0, freePlain), `Only ${Math.max(0, freePlain)} bottles are waiting to be washed and not yet given out.`);
      need(tc <= Math.max(0, freeCont), `Only ${Math.max(0, freeCont)} contaminated bottles are waiting to be washed and not yet given out.`);
      row.targetContaminated = tc;
    } else if (kind === 'MEDIA') {
      need(input.targetBottles > 0, 'Enter the number of bottles to be made.');
      need(db.recipes.some((r) => r.recipeId === input.recipeId), 'Choose the media code.');
      const code = (input.mediaBatchCode ?? '').trim();
      need(code.length >= 2, 'Enter the batch code for this media (for example B0001/26).');
      const lot = db.mediaLots.find((l) => l.lotCode.toLowerCase() === code.toLowerCase());
      need(!lot || lot.recipeId === input.recipeId, `Batch code ${code} is already used for ${recipeCode(lot?.recipeId)} media.`);
      need(!db.assignments.some((a) => a.assignId !== input.assignId && a.mediaBatchCode?.toLowerCase() === code.toLowerCase() && a.recipeId !== input.recipeId),
        `Batch code ${code} is already given out for another media code.`);
      row.recipeId = input.recipeId;
      row.mediaBatchCode = code;
    } else {
      need(input.targetBottles > 0, 'Enter the number of bottles to check.');
    }

    if (input.benchId !== null) {
      const bench = opts.benches.find((b) => b.benchId === input.benchId);
      need(bench && bench.areaId === areaId, `Choose a bench in ${areaName(areaId)}.`);
      if (bench!.hood) {
        const others = bench!.operatorIds.filter((id) => id !== input.operatorId);
        need(others.length < MAX_PER_HOOD, `${bench!.code} already has ${MAX_PER_HOOD} operators on this day (${others.map(nameOf).join(', ')}). Each hood takes at most ${MAX_PER_HOOD}.`);
      }
    }
    need(!db.assignments.some((a) => sameLine({ ...input, kind, batchId: row.batchId, stageId: row.stageId }, a)), 'This operator already has this work on this day. Change that line instead.');
    if (newBatch) row.batchId = ensureBatch(newBatch.code, newBatch.cropId, input.workDate).batch.batchId;
    if (old) {
      need(old.operatorId === input.operatorId || !db.entries.some((e) => e.assignId === old.assignId), 'Work has started on this line, so the operator cannot be changed.');
      need(kindOf(old) === kind || !db.entries.some((e) => e.assignId === old.assignId && live(e)), 'Work has started on this line, so its kind cannot be changed.');
      for (const k of ['batchId', 'stageId', 'targetContaminated', 'recipeId', 'mediaBatchCode'] as const) delete old[k];
      Object.assign(old, { ...row, assignedBy: user.userId });
      save();
      return copy(old);
    }
    const saved: WorkAssignment = { ...row, assignId: nextId(db.assignments, 'assignId'), assignedBy: user.userId };
    db.assignments.push(saved);
    save();
    return copy(saved);
  },

  async deleteAssignment(assignId: number, user: User): Promise<void> {
    await wait();
    const a = db.assignments.find((x) => x.assignId === assignId);
    need(a, 'Not found.');
    need(inCharge(user, a!.operatorId), 'This operator is not in your zones.');
    need(!db.entries.some((e) => e.assignId === assignId && live(e)), 'Work has already been entered for this line, so it cannot be removed.');
    db.assignments = db.assignments.filter((x) => x.assignId !== assignId);
    save();
  },

  /** Copies the last working day's work to this date for operators who are not absent. Returns how many lines were added. */
  async copyPreviousDay(date: string, user: User): Promise<number> {
    await wait();
    need(date >= today(), 'Work can only be given for today or a later date.');
    const ids = new Set(myOperators(user).map((u) => u.userId));
    const areas = visibleAreas(user);
    const mine = (a: WorkAssignment) => ids.has(a.operatorId) && (areas === null || areas.includes(assignArea(a) ?? -1));
    let from = '';
    for (let i = 1; i <= 7 && !from; i++) {
      const d = addDays(date, -i);
      if (db.assignments.some((a) => a.workDate === d && mine(a))) from = d;
    }
    need(from, 'No work was given in the last 7 days to copy from.');
    let added = 0;
    for (const a of db.assignments.filter((x) => x.workDate === from && mine(x))) {
      if (attOf(a.operatorId, date) === 'A') continue;
      const k = kindOf(a);
      const opts = await dailyApi.assignOptions(date, user);
      const input: AssignInput = {
        workDate: date, operatorId: a.operatorId, kind: k, areaId: assignArea(a), batchId: a.batchId, stageId: a.stageId, benchId: a.benchId,
        targetBottles: a.targetBottles, targetContaminated: a.targetContaminated, recipeId: a.recipeId,
        // Media gets a new batch code every day.
        mediaBatchCode: k === 'MEDIA' ? opts.nextMediaBatchCode : undefined,
      };
      if (k === 'SUBCULTURE') {
        const free = opts.batches.find((b) => b.batchId === a.batchId)?.stages.find((s) => s.stageId === a.stageId)?.free ?? 0;
        input.targetBottles = Math.min(a.targetBottles, free);
      } else if (k === 'WASH') {
        input.targetBottles = Math.min(a.targetBottles, Math.max(0, opts.wash.plain - opts.wash.givenPlain));
        input.targetContaminated = Math.min(a.targetContaminated ?? 0, Math.max(0, opts.wash.contaminated - opts.wash.givenContaminated));
      }
      try {
        await dailyApi.saveAssignment(input, user);
        added++;
      } catch {
        /* already given, no bottles left, or hood full: skip this line */
      }
    }
    return added;
  },

  // ---------- board: target vs done per operator for one day ----------
  /** One row per operator. With areaId, only the work done in that zone counts (for an operator in two zones). */
  async dailyBoard(date: string, user: User, areaId?: number): Promise<BoardRow[]> {
    await wait();
    const areas = visibleAreas(user);
    const here = (z: number | null) => (areaId !== undefined ? z === areaId : user.role !== 'SUPERVISOR' || areas === null || (z !== null && areas.includes(z)));
    return myOperators(user).map((u) => {
      const as = db.assignments.filter((a) => a.workDate === date && a.operatorId === u.userId && here(assignArea(a))).map(assignmentRow);
      const es = db.entries.filter((e) => e.workDate === date && e.operatorId === u.userId && live(e) && here(entryArea(e)));
      const target = as.reduce((n, a) => n + a.target, 0);
      const handled = es.reduce((n, e) => n + e.bottlesHandled, 0);
      const pct = pctOf(handled, target);
      const zones = [...new Set(as.map((a) => a.areaName))];
      return {
        operatorId: u.userId,
        fullName: u.fullName,
        areaName: zones.length ? zones.join(', ') : workZones(u).map(areaName).join(', '),
        attendance: attOf(u.userId, date),
        work: as.map((a) => a.label),
        target,
        handled,
        produced: es.reduce((n, e) => n + e.bottlesProduced, 0),
        lost: es.reduce((n, e) => n + (kindOf(e) === 'SUBCULTURE' ? e.bottlesLost : 0), 0),
        pending: es.filter((e) => e.status === 'PENDING').length,
        pct,
        level: outputLevel(pct, date),
      };
    }).sort((a, b) => a.areaName.localeCompare(b.areaName) || a.fullName.localeCompare(b.fullName));
  },

  // ---------- work done, typed in ----------
  /** Everything the "enter work by hand" form needs for one operator and day. */
  async entryOptions(date: string, operatorId: number, user: User): Promise<EntryOptions> {
    await wait();
    const op = userOf(operatorId);
    need(op && op.role === 'OPERATOR', 'Choose the operator.');
    const isOp = user.role === 'OPERATOR';
    if (isOp) need(operatorId === user.userId, 'You can only enter your own work.');
    else need(inCharge(user, operatorId), `${op!.fullName} is not in your zones.`);
    const zones = (isOp ? workZones(op!) : sharedZones(user, op!))
      .map((id) => db.areas.find((a) => a.areaId === id))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => ({ areaId: a.areaId, name: a.name, areaType: a.areaType, kinds: kindsForArea(a.areaId) }));
    const zoneIds = new Set(zones.map((z) => z.areaId));
    const stages = [...db.stages].sort((a, b) => a.seqNo - b.seqNo);
    const batches = db.batches.filter((b) => b.status === 'RUNNING').map((b) => ({
      batchId: b.batchId,
      batchCode: b.batchCode,
      growth: db.crops.find((c) => c.cropId === b.cropId)?.defaultGrowth ?? 2.5,
      stages: stages.map((s) => {
        const ts = traysFor(b.batchId, s.stageId, user);
        return { stageId: s.stageId, code: s.code, bottles: ts.reduce((n, t) => n + t.bottleCount, 0), trays: ts.length, benchId: ts[0]?.benchId ?? null };
      }).filter((s) => s.bottles > 0),
    })).filter((b) => b.stages.length > 0);
    const areas = visibleAreas(user);
    // New bottles go onto racks: benches in the growth room and hardening, plus any bench in the user's own zones.
    const rackZone = (areaId: number) => ['INCUBATION', 'HARDENING'].includes(db.areas.find((a) => a.areaId === areaId)?.areaType ?? '');
    const benches = db.benches
      .filter((b) => rackZone(b.areaId) || areas === null || areas.includes(b.areaId))
      .map((b) => ({ benchId: b.benchId, code: b.code, areaName: areaName(b.areaId), capacity: b.capacityTrays, trays: db.trays.filter((t) => t.status === 'ACTIVE' && t.benchId === b.benchId).length }));
    return {
      operator: { userId: op!.userId, fullName: op!.fullName, attendance: attOf(op!.userId, date) },
      lines: db.assignments.filter((a) => a.operatorId === operatorId && a.workDate === date && zoneIds.has(assignArea(a) ?? -1)).map(assignmentRow),
      zones,
      batches,
      stages: stages.map((s) => ({ stageId: s.stageId, code: s.code, phase: s.phase, seqNo: s.seqNo })),
      benches,
      wash: washPool(),
      media: mediaStatus(),
      nextMediaBatchCode: nextMediaBatchCode(date),
      allBatches: runningBatches(),
      crops: cropList(),
    };
  },


  /** Bottles of one batch and stage that can be taken for a typed-in sub-culture. */
  async bottlesAt(batchId: number, stageId: number, user: User): Promise<{ bottles: number; trays: number }> {
    await wait(50);
    const ts = traysFor(batchId, stageId, user);
    return { bottles: ts.reduce((n, t) => n + t.bottleCount, 0), trays: ts.length };
  },

  /**
   * Work typed in by hand instead of scanning a tray. The operator enters their own work for today;
   * a supervisor can enter it for an operator (up to 7 days back), and then it counts as checked.
   */
  async enterWork(input: WorkInput, user: User): Promise<EntryRow> {
    await wait();
    const isOp = user.role === 'OPERATOR';
    const op = userOf(input.operatorId);
    need(op && op.role === 'OPERATOR', 'Choose the operator.');
    if (isOp) {
      need(input.operatorId === user.userId, 'You can only enter your own work.');
      need(input.workDate === today(), 'Work can be entered for today only. Ask your supervisor to add an earlier day.');
    } else {
      need(inCharge(user, input.operatorId), `${op!.fullName} is not in your zones.`);
      need(input.workDate <= today() && input.workDate >= addDays(today(), -7), 'Work can be entered for today or up to 7 days back.');
    }
    need(attOf(input.operatorId, input.workDate) !== 'A', `${op!.fullName} is marked absent on this day.`);
    const kind = input.kind;
    // Which line of work it counts towards.
    let line = input.assignId ? db.assignments.find((a) => a.assignId === input.assignId) : undefined;
    if (input.assignId) need(line && line.operatorId === input.operatorId && line.workDate === input.workDate, 'That work line is not for this operator and day.');
    if (!line) {
      line = db.assignments.find((a) => a.operatorId === input.operatorId && a.workDate === input.workDate && kindOf(a) === kind
        && (kind !== 'SUBCULTURE' || (a.batchId === input.batchId && a.stageId === input.stageId))
        && (kind !== 'MEDIA' || a.recipeId === input.recipeId));
    }
    if (line) need(kindOf(line) === kind, 'This entry is a different kind of work from the line chosen.');
    const zones = isOp ? workZones(op!) : sharedZones(user, op!);
    const areaId = (line ? assignArea(line) : null) ?? input.areaId ?? zones.find((z) => kindsForArea(z).includes(kind)) ?? null;
    need(areaId !== null && workZones(op!).includes(areaId), `Choose one of ${op!.fullName}’s zones.`);
    need(kindsForArea(areaId).includes(kind), `${WORK_LABEL[kind]} is not done in ${areaName(areaId)}.`);
    const n = input.bottlesHandled;
    need(Number.isInteger(n) && n > 0, 'Enter the number of bottles, more than 0.');

    const entry: ProductionEntry = {
      entryId: nextId(db.entries, 'entryId'), assignId: line?.assignId ?? null, operatorId: op!.userId, kind, source: 'MANUAL',
      trayId: null, batchId: null, stageId: null, areaId, movementId: null, contId: null, workDate: input.workDate,
      bottlesHandled: n, bottlesProduced: 0, bottlesLost: 0,
      status: isOp ? 'PENDING' : 'VERIFIED', enteredAt: new Date().toISOString(),
      verifiedBy: isOp ? null : user.userId, verifiedAt: isOp ? null : new Date().toISOString(), note: (input.note ?? '').trim(),
      enteredBy: user.userId,
    };

    if (kind === 'SUBCULTURE') {
      const stageId = line?.stageId ?? (input.stageCode !== undefined ? stageByCode(input.stageCode).stageId : input.stageId);
      need(stageId, 'Type the stage.');
      let batchId = line?.batchId ?? input.batchId ?? null;
      let created = false;
      if (!line && input.batchCode !== undefined) {
        const b = ensureBatch(input.batchCode, input.cropId, input.workDate);
        batchId = b.batch.batchId;
        created = b.created;
      }
      need(batchId, 'Type the batch code.');
      const sub: CountSubcultureInput = {
        batchId: batchId!, stageId: stageId!, bottlesHandled: n, bottlesOut: input.bottlesOut ?? 0, bottlesLost: input.bottlesLost ?? 0,
        toStageId: input.toStageId ?? stageId!, toBenchId: input.toBenchId ?? 0, mediaLotId: input.mediaLotId, cause: input.cause, contType: input.contType,
      };
      let r: ReturnType<typeof subcultureByCount>;
      try {
        r = subcultureByCount(sub, user, user, input.workDate);
      } catch (e) {
        // Do not keep a batch added for an entry that could not be saved.
        if (created) db.batches = db.batches.filter((b) => b.batchId !== batchId);
        throw e;
      }
      Object.assign(entry, {
        batchId, stageId, taken: r.taken, movementId: r.movementId, contId: r.contId,
        bottlesProduced: sub.bottlesOut, bottlesLost: sub.bottlesLost,
      });
    } else if (kind === 'WASH') {
      const c = input.contaminated ?? 0;
      need(Number.isInteger(c) && c >= 0 && c <= n, 'Contaminated bottles must be between 0 and the bottles washed.');
      const pool = washPool();
      need(n - c <= pool.plain, `Only ${pool.plain} bottles are waiting to be washed.`);
      need(c <= pool.contaminated, `Only ${pool.contaminated} contaminated bottles are waiting to be washed.`);
      entry.contaminated = c;
    } else if (kind === 'MEDIA') {
      const recipeId = line?.recipeId ?? input.recipeId;
      const recipe = db.recipes.find((r) => r.recipeId === recipeId);
      need(recipe, 'Choose the media code.');
      const code = (line?.mediaBatchCode ?? input.mediaBatchCode ?? '').trim() || nextMediaBatchCode(input.workDate);
      let lot = db.mediaLots.find((l) => l.lotCode.toLowerCase() === code.toLowerCase());
      need(!lot || lot.recipeId === recipe!.recipeId, `Batch code ${code} is already used for ${recipeCode(lot?.recipeId)} media.`);
      const litres = input.litres ?? 0;
      need(litres >= 0, 'Litres cannot be negative.');
      if (lot) {
        lot.bottlesFilled += n;
        lot.volumeLitre = Math.round((lot.volumeLitre + litres) * 100) / 100;
      } else {
        lot = {
          mediaLotId: nextId(db.mediaLots, 'mediaLotId'), lotCode: code, recipeId: recipe!.recipeId, preparedOn: input.workDate,
          volumeLitre: litres, bottlesFilled: n, expiresOn: addDays(input.workDate, recipe!.shelfLifeDays), preparedBy: op!.userId,
        };
        db.mediaLots.push(lot);
      }
      entry.mediaLotId = lot.mediaLotId;
      entry.bottlesProduced = n;
    } else {
      const failed = input.bottlesLost ?? 0;
      need(Number.isInteger(failed) && failed >= 0 && failed <= n, 'Bottles that failed must be between 0 and the bottles checked.');
      entry.bottlesLost = failed;
    }
    db.entries.push(entry);
    save();
    return entryRow(entry);
  },

  // ---------- entries and checking ----------
  async listEntries(user: User, filter: { status?: EntryStatus; from?: string; to?: string } = {}): Promise<EntryRow[]> {
    await wait();
    const ids = new Set(user.role === 'OPERATOR' ? [user.userId] : myOperators(user).map((u) => u.userId));
    const areas = visibleAreas(user);
    return db.entries
      .filter((e) => ids.has(e.operatorId) && (!filter.status || e.status === filter.status) && (!filter.from || e.workDate >= filter.from) && (!filter.to || e.workDate <= filter.to))
      .filter((e) => user.role !== 'SUPERVISOR' || areas === null || areas.includes(entryArea(e) ?? -1))
      .map(entryRow)
      .sort((a, b) => b.enteredAt.localeCompare(a.enteredAt));
  },

  async verifyEntries(entryIds: number[], user: User): Promise<void> {
    await wait();
    need(entryIds.length > 0, 'Choose at least one entry.');
    const now = new Date().toISOString();
    for (const id of entryIds) {
      const e = db.entries.find((x) => x.entryId === id);
      need(e, 'Entry not found.');
      need(inCharge(user, e!.operatorId), `${nameOf(e!.operatorId)} is not in your zones.`);
      need(e!.status === 'PENDING', 'Only entries waiting for a check can be verified.');
      e!.status = 'VERIFIED';
      e!.verifiedBy = user.userId;
      e!.verifiedAt = now;
    }
    save();
  },

  /**
   * Sends an entry back. When nothing has used what it made, it is also undone:
   * a sub-culture's new trays are removed and the bottles go back to their trays; media bottles come off their lot.
   */
  async rejectEntry(entryId: number, reason: string, user: User): Promise<{ undone: boolean }> {
    await wait();
    const e = db.entries.find((x) => x.entryId === entryId);
    need(e, 'Entry not found.');
    need(inCharge(user, e!.operatorId), `${nameOf(e!.operatorId)} is not in your zones.`);
    need(e!.status === 'PENDING', 'Only entries waiting for a check can be sent back.');
    need(reason.trim().length >= 3, 'Write the reason, so the operator knows what to fix.');
    const k = kindOf(e!);
    const undone = canUndo(e!);
    if (undone && k === 'SUBCULTURE') {
      const m = movementOf(e!.movementId)!;
      db.trays = db.trays.filter((t) => !m.newTrayIds.includes(t.trayId));
      db.movements = db.movements.filter((x) => x.movementId !== m.movementId);
      if (e!.contId !== null) db.contaminations = db.contaminations.filter((c) => c.contId !== e!.contId);
      if (e!.taken) {
        for (const x of e!.taken) {
          const t = db.trays.find((y) => y.trayId === x.trayId);
          if (t) {
            t.bottleCount += x.bottles;
            t.status = 'ACTIVE';
          }
        }
      } else {
        const old = db.trays.find((t) => t.trayId === e!.trayId)!;
        old.status = 'ACTIVE';
      }
    } else if (undone && k === 'MEDIA') {
      const lot = db.mediaLots.find((l) => l.mediaLotId === e!.mediaLotId)!;
      lot.bottlesFilled -= e!.bottlesHandled;
      if (lot.bottlesFilled <= 0 && !db.entries.some((x) => x.entryId !== e!.entryId && x.mediaLotId === lot.mediaLotId && live(x))) {
        db.mediaLots = db.mediaLots.filter((l) => l.mediaLotId !== lot.mediaLotId);
      }
    }
    e!.status = 'REJECTED';
    e!.verifiedBy = user.userId;
    e!.verifiedAt = new Date().toISOString();
    e!.note = reason.trim();
    save();
    return { undone: undone && (k === 'SUBCULTURE' || k === 'MEDIA') };
  },

  // ---------- output: day totals, then split by operator, zone, work, batch and stage ----------
  async workOutput(user: User, f: OutputFilter): Promise<WorkOutput> {
    await wait();
    need(f.from <= f.to, 'The start date must be on or before the end date.');
    const areas = visibleAreas(user);
    const isOp = user.role === 'OPERATOR';
    const opIds = new Set(isOp ? [user.userId] : myOperators(user).map((u) => u.userId));
    const zoneOk = (areaId: number | null) => isOp || user.role === 'MANAGER' || areas === null || (areaId !== null && areas.includes(areaId));
    const inRange = (d: string) => d >= f.from && d <= f.to;

    // Everything in scope for the period, before the filters (used for the filter lists).
    const allE = db.entries.filter((e) => live(e) && inRange(e.workDate) && opIds.has(e.operatorId) && zoneOk(entryArea(e)));
    const allA = db.assignments.filter((a) => inRange(a.workDate) && opIds.has(a.operatorId) && zoneOk(assignArea(a)));

    const pass = (x: { operatorId: number; kind: WorkKind; areaId: number | null; batchId: number | null; stageId: number | null }) =>
      (!f.operatorId || x.operatorId === f.operatorId) && (!f.kind || x.kind === f.kind) && (!f.areaId || x.areaId === f.areaId)
      && (!f.batchId || x.batchId === f.batchId) && (!f.stageId || x.stageId === f.stageId);
    const es = allE.map((e) => ({ e, date: e.workDate, operatorId: e.operatorId, kind: kindOf(e), areaId: entryArea(e), batchId: entryBatch(e), stageId: entryStage(e) })).filter(pass);
    const as = allA.map((a) => ({ a, date: a.workDate, operatorId: a.operatorId, kind: kindOf(a), areaId: assignArea(a), batchId: a.batchId, stageId: a.stageId })).filter(pass);

    type Row = { date: string; operatorId: number; kind: WorkKind; areaId: number | null; batchId: number | null; stageId: number | null };
    const group = (keyOf: (x: Row) => string | null, labelOf: (k: string) => string, filterOf: (k: string) => Partial<OutputFilter>, withTarget = true): OutputGroup[] => {
      const g = new Map<string, OutputGroup>();
      const get = (k: string) => g.get(k) ?? (g.set(k, { key: k, label: labelOf(k), filter: filterOf(k), target: 0, handled: 0, produced: 0, lost: 0, entries: 0, pct: null }), g.get(k)!);
      for (const x of es) {
        const k = keyOf(x);
        if (k === null) continue;
        const r = get(k);
        r.handled += x.e.bottlesHandled;
        r.produced += x.e.bottlesProduced;
        r.lost += x.e.bottlesLost;
        r.entries += 1;
      }
      if (withTarget) for (const x of as) {
        const k = keyOf(x);
        if (k === null) continue;
        get(k).target += targetOf(x.a);
      }
      return [...g.values()].map((r) => ({ ...r, pct: pctOf(r.handled, r.target) }));
    };
    const byHandled = (a: OutputGroup, b: OutputGroup) => b.handled - a.handled || a.label.localeCompare(b.label);

    const days = group((x) => x.date, (k) => k, (k) => ({ from: k, to: k }));
    const byDay = days.map((r) => ({ ...r, date: r.key })).sort((a, b) => b.date.localeCompare(a.date));
    const byOperator = group((x) => String(x.operatorId), (k) => nameOf(Number(k)), (k) => ({ operatorId: Number(k) })).sort(byHandled);
    const byZone = group((x) => (x.areaId === null ? null : String(x.areaId)), (k) => areaName(Number(k)), (k) => ({ areaId: Number(k) })).sort(byHandled);
    const byKind = group((x) => x.kind, (k) => WORK_LABEL[k as WorkKind], (k) => ({ kind: k as WorkKind })).sort(byHandled);
    const byBatch = group((x) => (x.kind === 'SUBCULTURE' && x.batchId !== null ? String(x.batchId) : null), (k) => batchCode(Number(k)), (k) => ({ batchId: Number(k), kind: 'SUBCULTURE' })).sort(byHandled);
    const seq = (id: number) => db.stages.find((s) => s.stageId === id)?.seqNo ?? 0;
    const byStage = group((x) => (x.kind === 'SUBCULTURE' && x.stageId !== null ? String(x.stageId) : null), (k) => stageCode(Number(k)), (k) => ({ stageId: Number(k), kind: 'SUBCULTURE' }))
      .sort((a, b) => seq(Number(a.key)) - seq(Number(b.key)));

    const handled = es.reduce((n, x) => n + x.e.bottlesHandled, 0);
    const target = as.reduce((n, x) => n + targetOf(x.a), 0);
    const pendingAll = db.entries.filter((e) => e.status === 'PENDING' && inRange(e.workDate) && opIds.has(e.operatorId) && zoneOk(entryArea(e)));
    const uniq = <T,>(xs: T[]) => [...new Set(xs)];
    return {
      totals: {
        target, handled,
        produced: es.reduce((n, x) => n + x.e.bottlesProduced, 0),
        lost: es.reduce((n, x) => n + (x.kind === 'SUBCULTURE' ? x.e.bottlesLost : 0), 0),
        entries: es.length,
        pending: es.filter((x) => pendingAll.includes(x.e)).length,
        operators: uniq(es.map((x) => x.operatorId)).length,
        days: uniq(es.map((x) => x.e.workDate)).length,
      },
      byDay, byOperator, byZone, byKind, byBatch, byStage,
      entries: es.map((x) => entryRow(x.e)).sort((a, b) => b.workDate.localeCompare(a.workDate) || b.enteredAt.localeCompare(a.enteredAt)).slice(0, 400),
      options: {
        operators: uniq([...allE.map((e) => e.operatorId), ...allA.map((a) => a.operatorId)]).map((id) => ({ userId: id, fullName: nameOf(id) })).sort((a, b) => a.fullName.localeCompare(b.fullName)),
        zones: uniq([...allE.map(entryArea), ...allA.map(assignArea)].filter((z): z is number => z !== null)).map((id) => ({ areaId: id, name: areaName(id) })).sort((a, b) => a.name.localeCompare(b.name)),
        batches: uniq([...allE.map(entryBatch), ...allA.map((a) => a.batchId)].filter((z): z is number => z !== null)).map((id) => ({ batchId: id, batchCode: batchCode(id) })).sort((a, b) => a.batchCode.localeCompare(b.batchCode)),
        stages: uniq([...allE.map(entryStage), ...allA.map((a) => a.stageId)].filter((z): z is number => z !== null)).sort((a, b) => seq(a) - seq(b)).map((id) => ({ stageId: id, code: stageCode(id) })),
        kinds: uniq([...allE.map(kindOf), ...allA.map(kindOf)]),
      },
    };
  },

  // ---------- operator's own views ----------
  async myOutput(user: User, days: number): Promise<DayOutput[]> {
    await wait();
    const out: DayOutput[] = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(today(), -i);
      const as = db.assignments.filter((a) => a.workDate === d && a.operatorId === user.userId);
      const es = db.entries.filter((e) => e.workDate === d && e.operatorId === user.userId && live(e));
      const att = attOf(user.userId, d);
      if (!as.length && !es.length && !att) continue;
      const target = as.reduce((n, a) => n + targetOf(a), 0);
      const handled = es.reduce((n, e) => n + e.bottlesHandled, 0);
      out.push({
        workDate: d, attendance: att, target, handled,
        produced: es.reduce((n, e) => n + e.bottlesProduced, 0),
        lost: es.reduce((n, e) => n + e.bottlesLost, 0),
        pending: es.filter((e) => e.status === 'PENDING').length,
        verified: es.filter((e) => e.status === 'VERIFIED').length,
        pct: pctOf(handled, target),
        level: outputLevel(pctOf(handled, target), d),
      });
    }
    return out;
  },

  /** Entries the supervisor sent back in the last 3 days, so the operator sees why. */
  async mySentBack(user: User): Promise<EntryRow[]> {
    await wait();
    const from = addDays(today(), -3);
    return db.entries.filter((e) => e.operatorId === user.userId && e.status === 'REJECTED' && e.workDate >= from).map(entryRow);
  },

  async todayAttendance(user: User): Promise<AttStatus | null> {
    await wait(50);
    return attOf(user.userId, today());
  },
};

