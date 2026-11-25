// Production rules shared by the routes: who can see which trays, tray and batch summaries,
// making new trays, and checking media lots. Mirrors the website's rules (frontend/src/lib/productionApi.ts).
import type { Batch, Prisma, Stage, Tray } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../db/prisma.js';
import { daysBetween, isoDate, labToday } from '../lib/dates.js';
import { visibleAreaIds } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';

export const TRAY_MAX = 30;
/** More new bottles than this per good bottle is almost surely a typing mistake (same limit as the forecast). */
export const MAX_GROWTH = 6;

type Db = Prisma.TransactionClient;
export type Overdue = 'OK' | 'WARNING' | 'CRITICAL';

/** Lookup tables loaded once per request (they are small). */
export async function loadLookups(db: Db = prisma) {
  const [stages, benches, areas, batches, crops, rule] = await Promise.all([
    db.stage.findMany({ orderBy: { seqNo: 'asc' } }),
    db.bench.findMany(),
    db.area.findMany(),
    db.batch.findMany(),
    db.crop.findMany(),
    db.alertRule.findUnique({ where: { code: 'TRAY_OVERDUE' } }),
  ]);
  const stageById = new Map(stages.map((s) => [s.stageId, s]));
  const benchById = new Map(benches.map((b) => [b.benchId, b]));
  const areaById = new Map(areas.map((a) => [a.areaId, a]));
  const batchById = new Map(batches.map((b) => [b.batchId, b]));
  const cropById = new Map(crops.map((c) => [c.cropId, c]));
  const overdueLevel = (days: number): Overdue => {
    if (!rule) return 'OK';
    if (rule.criticalValue !== null && days > rule.criticalValue) return 'CRITICAL';
    return days > rule.warnValue ? 'WARNING' : 'OK';
  };
  return { stages, stageById, benchById, areaById, batchById, cropById, overdueLevel };
}
export type Lookups = Awaited<ReturnType<typeof loadLookups>>;

/** Who is asking, and which trays they may see. */
export interface Scope {
  userId: number;
  role: 'MANAGER' | 'SUPERVISOR' | 'OPERATOR';
  /** Zones the user may see; null means every zone. */
  areas: number[] | null;
  /** Operator only: batches they were given work on today; they may open those trays in any zone. */
  assignedBatches: Set<number>;
}

export async function scopeOf(req: Request): Promise<Scope> {
  const u = req.user!;
  const assigned =
    u.role === 'OPERATOR'
      ? await prisma.workAssignment.findMany({ where: { operatorId: u.userId, workDate: new Date(`${labToday()}T00:00:00Z`), batchId: { not: null } }, select: { batchId: true } })
      : [];
  return { userId: u.userId, role: u.role, areas: visibleAreaIds(req), assignedBatches: new Set(assigned.map((a) => a.batchId as number)) };
}

/** Database filter for trays the user may see. */
export function trayScopeWhere(s: Scope): Prisma.TrayWhereInput {
  if (s.areas === null) return {};
  return { OR: [{ bench: { areaId: { in: s.areas } } }, ...(s.assignedBatches.size ? [{ batchId: { in: [...s.assignedBatches] } }] : [])] };
}

export function canSeeTray(s: Scope, t: Pick<Tray, 'benchId' | 'batchId'>, lk: Lookups) {
  if (s.areas === null) return true;
  const a = lk.benchById.get(t.benchId)?.areaId;
  if (a !== undefined && s.areas.includes(a)) return true;
  return s.role === 'OPERATOR' && s.assignedBatches.has(t.batchId);
}

/** A tray as the website shows it. */
export function trayRow(t: Tray, lk: Lookups) {
  const bench = lk.benchById.get(t.benchId);
  const area = bench ? lk.areaById.get(bench.areaId) : undefined;
  const placedOn = isoDate(t.placedOn);
  const days = daysBetween(placedOn);
  return {
    trayId: t.trayId, qrCode: t.qrCode, batchId: t.batchId, stageId: t.stageId, benchId: t.benchId, mediaLotId: t.mediaLotId,
    bottleCount: t.bottleCount, startBottles: t.startBottles ?? undefined, placedOn, status: t.status, version: t.version,
    batchCode: lk.batchById.get(t.batchId)?.batchCode ?? '—',
    stageCode: lk.stageById.get(t.stageId)?.code ?? '—',
    benchCode: bench?.code ?? '—',
    areaId: area?.areaId ?? null,
    areaName: area?.name ?? '—',
    daysInStage: days,
    overdue: lk.overdueLevel(days),
  };
}

export const batchOut = (b: Batch) => ({
  batchId: b.batchId, batchCode: b.batchCode, cropId: b.cropId, parentBatchId: b.parentBatchId, startDate: isoDate(b.startDate), status: b.status,
});

/** A batch with its live counts. `trays` are the trays the user may see (all trays for the manager). */
export function batchSummary(b: Batch, trays: Tray[], lostBottles: number, lk: Lookups) {
  const active = trays.filter((t) => t.batchId === b.batchId && t.status === 'ACTIVE');
  const byStage = lk.stages
    .map((s) => {
      const ts = active.filter((t) => t.stageId === s.stageId);
      return { stageCode: s.code, bottles: ts.reduce((n, t) => n + t.bottleCount, 0), trays: ts.length };
    })
    .filter((x) => x.trays > 0);
  const main = [...byStage].sort((x, y) => y.bottles - x.bottles)[0];
  const crop = lk.cropById.get(b.cropId);
  return {
    ...batchOut(b),
    cropName: crop ? `${crop.name} ${crop.variety}` : '—',
    parentCode: b.parentBatchId ? lk.batchById.get(b.parentBatchId)?.batchCode ?? null : null,
    activeTrays: active.length,
    liveBottles: active.reduce((n, t) => n + t.bottleCount, 0),
    byStage,
    mainStage: main?.stageCode ?? '—',
    lostBottles,
    ageDays: daysBetween(isoDate(b.startDate)),
    overdueTrays: active.filter((t) => lk.overdueLevel(daysBetween(isoDate(t.placedOn))) !== 'OK').length,
  };
}

/** Bottles lost per batch (all trays of the batch). */
export async function lostByBatch(db: Db = prisma): Promise<Map<number, number>> {
  const rows = await db.contamination.findMany({ select: { bottlesLost: true, tray: { select: { batchId: true } } } });
  const m = new Map<number, number>();
  for (const r of rows) m.set(r.tray.batchId, (m.get(r.tray.batchId) ?? 0) + r.bottlesLost);
  return m;
}

/** Splits bottles into new trays of up to 30, with QR codes that continue the batch's numbering. */
export async function makeTrays(db: Db, batch: Pick<Batch, 'batchId' | 'batchCode'>, stageId: number, benchId: number, bottles: number, mediaLotId: number | null): Promise<Tray[]> {
  if (bottles <= 0) return [];
  // Highest number already used with this batch code (a split batch's trays keep their old codes).
  const prefix = `${batch.batchCode}-`;
  const taken = await db.tray.findMany({ where: { qrCode: { startsWith: prefix } }, select: { qrCode: true } });
  let seq = taken.reduce((n, t) => {
    const k = Number(t.qrCode.slice(prefix.length));
    return Number.isInteger(k) ? Math.max(n, k) : n;
  }, 0);
  const placedOn = new Date(`${labToday()}T00:00:00Z`);
  const rows: Prisma.TrayCreateManyInput[] = [];
  for (let left = bottles; left > 0; left -= TRAY_MAX) {
    const n = Math.min(TRAY_MAX, left);
    rows.push({ qrCode: `${prefix}${String(++seq).padStart(4, '0')}`, batchId: batch.batchId, stageId, benchId, mediaLotId, bottleCount: n, startBottles: n, placedOn });
  }
  const made = await db.tray.createManyAndReturn({ data: rows });
  return made.sort((a, b) => a.trayId - b.trayId);
}

/** A media lot can fill this many new bottles for the stage they go to. */
export async function checkLot(db: Db, mediaLotId: number | null | undefined, to: Pick<Stage, 'phase' | 'code'>, bottlesOut: number) {
  if (!mediaLotId) return;
  const lot = await db.mediaLot.findUnique({ where: { mediaLotId }, include: { recipe: true } });
  if (!lot) throw new ApiError(400, 'Media lot not found.');
  if (lot.recipe.phase !== to.phase) throw new ApiError(400, `Lot ${lot.lotCode} is ${lot.recipe.code} medium, not for ${to.code}.`);
  if (labToday() > isoDate(lot.expiresOn)) throw new ApiError(400, `Lot ${lot.lotCode} expired on ${isoDate(lot.expiresOn)}.`);
  const used = await db.tray.findMany({ where: { mediaLotId }, select: { startBottles: true, bottleCount: true } });
  const n = used.reduce((k, t) => k + (t.startBottles ?? t.bottleCount), 0);
  if (n + bottlesOut > lot.bottlesFilled) throw new ApiError(400, `Lot ${lot.lotCode} has only ${Math.max(0, lot.bottlesFilled - n)} bottles left.`);
}

/** Changes a tray only if nobody else changed it since it was read. */
export async function updateTray(db: Db, t: Pick<Tray, 'trayId' | 'version' | 'qrCode'>, data: Prisma.TrayUncheckedUpdateManyInput) {
  const r = await db.tray.updateMany({ where: { trayId: t.trayId, version: t.version, status: 'ACTIVE' }, data: { ...data, version: { increment: 1 } } });
  if (r.count !== 1) throw new ApiError(409, `Tray ${t.qrCode} was just changed by someone else. Open it again and check.`);
}
