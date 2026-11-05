// FAKE API, daily-work part: attendance, work given to operators, and checking their entries.
// Scope: manager sees every operator; a supervisor sees operators whose zone they look after;
// an operator sees only their own records.
import { addDays, copy, need, today, wait } from './apiUtil';
import { visibleAreas } from './productionApi';
import { db, nextId, save } from './store';
import type { Attendance, AttStatus, Bench, EntryStatus, ProductionEntry, User, WorkAssignment } from './types';

// ---------- helpers ----------
const nameOf = (id: number | null) => db.users.find((u) => u.userId === id)?.fullName ?? '—';
const stageCode = (id: number) => db.stages.find((s) => s.stageId === id)?.code ?? '—';
const batchCode = (id: number) => db.batches.find((b) => b.batchId === id)?.batchCode ?? '—';
const benchCode = (id: number | null) => db.benches.find((b) => b.benchId === id)?.code ?? '—';
const areaName = (id: number | null) => db.areas.find((a) => a.areaId === id)?.name ?? '—';
const benchArea = (benchId: number) => db.benches.find((b) => b.benchId === benchId)?.areaId ?? null;

/** Active operators the user is in charge of. */
function myOperators(user: User): User[] {
  need(user.role !== 'OPERATOR', 'Only a supervisor or manager can do this.');
  const areas = visibleAreas(user);
  return db.users.filter((u) => u.role === 'OPERATOR' && u.status === 'ACTIVE' && (areas === null || (u.homeAreaId !== null && areas.includes(u.homeAreaId))));
}
const inCharge = (user: User, operatorId: number) => myOperators(user).some((u) => u.userId === operatorId);
const attOf = (userId: number, date: string) => db.attendance.find((a) => a.userId === userId && a.workDate === date)?.status ?? null;
const live = (e: ProductionEntry) => e.status !== 'REJECTED';

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

// ---------- shapes returned to pages ----------
export interface AttendanceRow {
  userId: number;
  fullName: string;
  areaName: string;
  status: AttStatus | null;
  markedByName: string | null;
}

export interface AssignmentRow extends WorkAssignment {
  operatorName: string;
  batchCode: string;
  stageCode: string;
  benchCode: string;
  handled: number;
  produced: number;
  lost: number;
  entries: number;
  pending: number;
  pct: number | null;
  level: Level;
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
  operatorName: string;
  qrCode: string;
  batchCode: string;
  stageCode: string;
  areaName: string;
  verifiedByName: string | null;
  /** True when the entry has no matching work assignment (operator did work not given to them). */
  unassigned: boolean;
  /** True when a reject can also undo the sub-culture (the new trays have not been touched since). */
  undoable: boolean;
}

export interface AssignOptions {
  operators: { userId: number; fullName: string; areaId: number | null; attendance: AttStatus | null }[];
  batches: { batchId: number; batchCode: string; stages: { stageId: number; code: string; bottles: number; trays: number; free: number }[] }[];
  benches: (Bench & { areaName: string })[];
}

export interface AssignInput {
  assignId?: number;
  workDate: string;
  operatorId: number;
  batchId: number;
  stageId: number;
  benchId: number | null;
  targetBottles: number;
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

function assignmentRow(a: WorkAssignment): AssignmentRow {
  const es = db.entries.filter((e) => e.assignId === a.assignId && live(e));
  const handled = es.reduce((n, e) => n + e.bottlesHandled, 0);
  const pct = pctOf(handled, a.targetBottles);
  return {
    ...copy(a),
    operatorName: nameOf(a.operatorId),
    batchCode: batchCode(a.batchId),
    stageCode: stageCode(a.stageId),
    benchCode: benchCode(a.benchId),
    handled,
    produced: es.reduce((n, e) => n + e.bottlesProduced, 0),
    lost: es.reduce((n, e) => n + e.bottlesLost, 0),
    entries: es.length,
    pending: es.filter((e) => e.status === 'PENDING').length,
    pct,
    level: outputLevel(pct, a.workDate),
  };
}

/** A rejected entry can undo its sub-culture only if the new trays are still exactly as made. */
function canUndo(e: ProductionEntry): boolean {
  if (e.movementId === null || e.status === 'REJECTED') return false;
  const m = db.movements.find((x) => x.movementId === e.movementId);
  if (!m) return false;
  const made = db.trays.filter((t) => m.newTrayIds.includes(t.trayId));
  if (made.length !== m.newTrayIds.length || made.some((t) => t.status !== 'ACTIVE')) return false;
  if (db.movements.some((x) => m.newTrayIds.includes(x.trayId))) return false;
  if (db.contaminations.some((c) => m.newTrayIds.includes(c.trayId))) return false;
  const old = db.trays.find((t) => t.trayId === e.trayId);
  return !!old && old.status !== 'ACTIVE';
}

function entryRow(e: ProductionEntry): EntryRow {
  const t = db.trays.find((x) => x.trayId === e.trayId);
  return {
    ...copy(e),
    operatorName: nameOf(e.operatorId),
    qrCode: t?.qrCode ?? '—',
    batchCode: t ? batchCode(t.batchId) : '—',
    stageCode: t ? stageCode(t.stageId) : '—',
    areaName: areaName(db.users.find((u) => u.userId === e.operatorId)?.homeAreaId ?? null),
    verifiedByName: e.verifiedBy ? nameOf(e.verifiedBy) : null,
    unassigned: e.assignId === null,
    undoable: canUndo(e),
  };
}

export const dailyApi = {
  // ---------- attendance ----------
  async getAttendance(date: string, user: User): Promise<AttendanceRow[]> {
    await wait();
    return myOperators(user).map((u) => {
      const a = db.attendance.find((x) => x.userId === u.userId && x.workDate === date);
      return { userId: u.userId, fullName: u.fullName, areaName: areaName(u.homeAreaId), status: a?.status ?? null, markedByName: a ? nameOf(a.markedBy) : null };
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
    const ops = myOperators(user);
    const inScope = (benchId: number) => {
      const a = benchArea(benchId);
      return areas === null || (a !== null && areas.includes(a));
    };
    const stages = [...db.stages].sort((a, b) => a.seqNo - b.seqNo);
    const taken = (batchId: number, stageId: number) =>
      db.assignments.filter((a) => a.workDate === date && a.batchId === batchId && a.stageId === stageId).reduce((n, a) => n + a.targetBottles, 0);
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
    const opAreas = new Set(ops.map((o) => o.homeAreaId));
    return {
      operators: ops.map((o) => ({ userId: o.userId, fullName: o.fullName, areaId: o.homeAreaId, attendance: attOf(o.userId, date) })),
      batches,
      benches: db.benches.filter((b) => opAreas.has(b.areaId)).map((b) => ({ ...copy(b), areaName: areaName(b.areaId) })),
    };
  },

  async listAssignments(date: string, user: User): Promise<AssignmentRow[]> {
    await wait();
    const ids = new Set(user.role === 'OPERATOR' ? [user.userId] : myOperators(user).map((u) => u.userId));
    return db.assignments
      .filter((a) => a.workDate === date && ids.has(a.operatorId))
      .map(assignmentRow)
      .sort((a, b) => a.operatorName.localeCompare(b.operatorName));
  },

  async saveAssignment(input: AssignInput, user: User): Promise<WorkAssignment> {
    await wait();
    need(input.workDate >= today(), 'Work can only be given for today or a later date.');
    need(inCharge(user, input.operatorId), 'This operator is not in your zones.');
    need(attOf(input.operatorId, input.workDate) !== 'A', `${nameOf(input.operatorId)} is marked absent on this day.`);
    need(Number.isInteger(input.targetBottles) && input.targetBottles > 0, 'Target must be a whole number of bottles, more than 0.');
    const opts = await dailyApi.assignOptions(input.workDate, user);
    const st = opts.batches.find((b) => b.batchId === input.batchId)?.stages.find((s) => s.stageId === input.stageId);
    need(st, 'This batch has no trays at that stage in your zones.');
    const old = input.assignId ? db.assignments.find((a) => a.assignId === input.assignId) : undefined;
    const free = st!.free + (old && old.batchId === input.batchId && old.stageId === input.stageId ? old.targetBottles : 0);
    need(input.targetBottles <= free, `Only ${free} bottles of ${batchCode(input.batchId)} at ${st!.code} are left to give out on this day.`);
    if (input.benchId !== null) need(opts.benches.some((b) => b.benchId === input.benchId), 'Choose a bench in the operator’s zone.');
    need(!db.assignments.some((a) => a.assignId !== input.assignId && a.workDate === input.workDate && a.operatorId === input.operatorId && a.batchId === input.batchId && a.stageId === input.stageId),
      'This operator already has this batch and stage on this day. Change that line instead.');
    if (old) {
      need(old.operatorId === input.operatorId || !db.entries.some((e) => e.assignId === old.assignId), 'Work has started on this line, so the operator cannot be changed.');
      Object.assign(old, { ...input, assignedBy: user.userId });
      save();
      return copy(old);
    }
    const row: WorkAssignment = { ...input, assignId: nextId(db.assignments, 'assignId'), assignedBy: user.userId };
    db.assignments.push(row);
    save();
    return copy(row);
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
    let from = '';
    for (let i = 1; i <= 7 && !from; i++) {
      const d = addDays(date, -i);
      if (db.assignments.some((a) => a.workDate === d && ids.has(a.operatorId))) from = d;
    }
    need(from, 'No work was given in the last 7 days to copy from.');
    let added = 0;
    for (const a of db.assignments.filter((x) => x.workDate === from && ids.has(x.operatorId))) {
      if (attOf(a.operatorId, date) === 'A') continue;
      if (db.assignments.some((x) => x.workDate === date && x.operatorId === a.operatorId && x.batchId === a.batchId && x.stageId === a.stageId)) continue;
      const opts = await dailyApi.assignOptions(date, user);
      const free = opts.batches.find((b) => b.batchId === a.batchId)?.stages.find((s) => s.stageId === a.stageId)?.free ?? 0;
      if (free <= 0) continue;
      db.assignments.push({ ...a, assignId: nextId(db.assignments, 'assignId'), workDate: date, targetBottles: Math.min(a.targetBottles, free), assignedBy: user.userId });
      added++;
    }
    save();
    return added;
  },

  // ---------- board: target vs done per operator for one day ----------
  async dailyBoard(date: string, user: User): Promise<BoardRow[]> {
    await wait();
    return myOperators(user).map((u) => {
      const as = db.assignments.filter((a) => a.workDate === date && a.operatorId === u.userId).map(assignmentRow);
      const es = db.entries.filter((e) => e.workDate === date && e.operatorId === u.userId && live(e));
      const target = as.reduce((n, a) => n + a.targetBottles, 0);
      const handled = es.reduce((n, e) => n + e.bottlesHandled, 0);
      const pct = pctOf(handled, target);
      return {
        operatorId: u.userId,
        fullName: u.fullName,
        areaName: areaName(u.homeAreaId),
        attendance: attOf(u.userId, date),
        work: as.map((a) => `${a.batchCode} · ${a.stageCode}`),
        target,
        handled,
        produced: es.reduce((n, e) => n + e.bottlesProduced, 0),
        lost: es.reduce((n, e) => n + e.bottlesLost, 0),
        pending: es.filter((e) => e.status === 'PENDING').length,
        pct,
        level: outputLevel(pct, date),
      };
    }).sort((a, b) => a.areaName.localeCompare(b.areaName) || a.fullName.localeCompare(b.fullName));
  },

  // ---------- entries and checking ----------
  async listEntries(user: User, filter: { status?: EntryStatus; from?: string; to?: string } = {}): Promise<EntryRow[]> {
    await wait();
    const ids = new Set(user.role === 'OPERATOR' ? [user.userId] : myOperators(user).map((u) => u.userId));
    return db.entries
      .filter((e) => ids.has(e.operatorId) && (!filter.status || e.status === filter.status) && (!filter.from || e.workDate >= filter.from) && (!filter.to || e.workDate <= filter.to))
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

  /** Sends an entry back. If the new trays are untouched, the sub-culture is undone: new trays removed, old tray active again. */
  async rejectEntry(entryId: number, reason: string, user: User): Promise<{ undone: boolean }> {
    await wait();
    const e = db.entries.find((x) => x.entryId === entryId);
    need(e, 'Entry not found.');
    need(inCharge(user, e!.operatorId), `${nameOf(e!.operatorId)} is not in your zones.`);
    need(e!.status === 'PENDING', 'Only entries waiting for a check can be sent back.');
    need(reason.trim().length >= 3, 'Write the reason, so the operator knows what to fix.');
    const undone = canUndo(e!);
    if (undone) {
      const m = db.movements.find((x) => x.movementId === e!.movementId)!;
      db.trays = db.trays.filter((t) => !m.newTrayIds.includes(t.trayId));
      db.movements = db.movements.filter((x) => x.movementId !== m.movementId);
      if (e!.contId !== null) db.contaminations = db.contaminations.filter((c) => c.contId !== e!.contId);
      const old = db.trays.find((t) => t.trayId === e!.trayId)!;
      old.status = 'ACTIVE';
    }
    e!.status = 'REJECTED';
    e!.verifiedBy = user.userId;
    e!.verifiedAt = new Date().toISOString();
    e!.note = reason.trim();
    save();
    return { undone };
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
      const target = as.reduce((n, a) => n + a.targetBottles, 0);
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
