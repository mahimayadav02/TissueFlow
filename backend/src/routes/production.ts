// Batches, trays, sub-culture, tray moves and losses.
// Who sees what: manager everything; supervisor the trays on benches in their zones;
// operator the trays in their own zones, plus trays of batches they were given work on today.
import { Router } from 'express';
import type { Prisma, TrayMovement } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { audit } from '../lib/audit.js';
import { dbDate, isIsoDate, isoDate, labDate, labToday } from '../lib/dates.js';
import { idParam } from '../lib/params.js';
import { parseBody } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import {
  MAX_GROWTH, batchOut, batchSummary, canSeeTray, checkLot, loadLookups, lostByBatch, makeTrays, scopeOf, trayRow, trayScopeWhere, updateTray,
  type Lookups,
} from '../services/production.js';

export const production = Router();
production.use(requireAuth);
const manager = requireRole('MANAGER');

const isoDay = z.string().refine(isIsoDate, 'Use a date like 2026-11-25.');
const causes = z.enum(['LAB', 'OPERATOR', 'SEASON', 'MEDIA']);
const lossTypes = z.enum(['FUNGAL', 'BACTERIAL', 'OTHER']);
const count = (label: string) => z.number({ error: `${label} must be a number.` }).int(`${label} must be a whole number.`).min(0, `${label} cannot be negative.`);

// ---------- batches ----------
production.get('/batches', async (req, res) => {
  const includeClosed = req.query.includeClosed === '1' || req.query.includeClosed === 'true';
  const scope = await scopeOf(req);
  const [lk, trays, lost] = await Promise.all([
    loadLookups(),
    prisma.tray.findMany({ where: { status: 'ACTIVE', ...trayScopeWhere(scope) } }),
    lostByBatch(),
  ]);
  const seen = new Set(trays.map((t) => t.batchId));
  const list = [...lk.batchById.values()]
    .filter((b) => (includeClosed || b.status === 'RUNNING') && (scope.areas === null || seen.has(b.batchId)))
    .map((b) => batchSummary(b, trays, lost.get(b.batchId) ?? 0, lk))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.batchCode.localeCompare(b.batchCode));
  res.json(list);
});

production.get('/batches/:id', async (req, res) => {
  const batchId = idParam(req);
  const scope = await scopeOf(req);
  const lk = await loadLookups();
  const b = lk.batchById.get(batchId);
  if (!b) throw new ApiError(404, 'Batch not found.');
  const [all, samples, moves, losses, lost] = await Promise.all([
    prisma.tray.findMany({ where: { batchId } }),
    prisma.sample.findMany({ where: { batchId }, orderBy: { sampleId: 'asc' } }),
    prisma.trayMovement.findMany({ where: { batchId }, orderBy: { movedAt: 'asc' } }),
    prisma.contamination.findMany({ where: { tray: { batchId } }, include: { tray: true, reporter: { select: { fullName: true } } }, orderBy: { foundOn: 'desc' } }),
    lostByBatch(),
  ]);
  const mine = all.filter((t) => canSeeTray(scope, t, lk));
  if (scope.areas !== null && mine.length === 0) throw new ApiError(403, 'This batch has no trays in your zones.');
  const code = (id: number) => lk.stageById.get(id)?.code ?? '—';
  const history = [...moves.filter((m) => m.fromBenchId === null), ...groupMoves(moves)]
    .map((m) => ({ ...moveOut(m), fromCode: code(m.fromStageId), toCode: code(m.toStageId) }))
    .sort((x, y) => x.movedAt.localeCompare(y.movedAt));
  res.json({
    batch: batchSummary(b, scope.areas === null ? all : mine, lost.get(batchId) ?? 0, lk),
    samples: samples.map((s) => ({ ...s, collectedAt: s.collectedAt.toISOString() })),
    trays: mine.filter((t) => t.status === 'ACTIVE').map((t) => trayRow(t, lk)).sort((x, y) => x.qrCode.localeCompare(y.qrCode)),
    history,
    losses: losses.map((c) => lossOut(c, lk)),
    children: [...lk.batchById.values()].filter((x) => x.parentBatchId === batchId).map((x) => ({ batchId: x.batchId, batchCode: x.batchCode })),
  });
});

const sampleBody = z.object({
  sampleType: z.string().trim().min(1, 'Every sample needs a type.').max(100),
  noOfSamples: z.number().int().positive('Number of samples must be more than 0.'),
  sampleSize: z.number().int().positive('Sample size must be more than 0.'),
  sourceFarm: z.string().trim().max(200).default(''),
  collectedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Use a valid date for the sample.'),
});

production.post('/batches', manager, async (req, res) => {
  const body = parseBody(
    z.object({
      cropId: z.number().int().positive(),
      startDate: isoDay,
      samples: z.array(sampleBody).min(1, 'Add at least one sample.').max(50),
      bottles: z.number().int().positive('Bottles inoculated must be more than 0.').max(100_000),
      benchId: z.number().int().positive(),
    }),
    req.body,
  );
  if (body.startDate > labToday()) throw new ApiError(400, 'The start date cannot be in the future.');
  const [crop, bench, first] = await Promise.all([
    prisma.crop.findUnique({ where: { cropId: body.cropId } }),
    prisma.bench.findUnique({ where: { benchId: body.benchId } }),
    prisma.stage.findFirst({ orderBy: { seqNo: 'asc' } }),
  ]);
  if (!crop) throw new ApiError(400, 'Choose a crop.');
  if (!bench) throw new ApiError(400, 'Choose a bench.');
  if (!first) throw new ApiError(400, 'Add stages in Set-up first.');

  const batch = await prisma.$transaction(async (tx) => {
    // Code from the start month: B11-26, then B11-26B, B11-26C … if taken.
    const d = dbDate(body.startDate);
    const base = `B${d.getUTCMonth() + 1}-${String(d.getUTCFullYear()).slice(2)}`;
    let code = base;
    for (let i = 0; await tx.batch.findUnique({ where: { batchCode: code } }); i++) code = base + String.fromCharCode(66 + i);
    const batch = await tx.batch.create({ data: { batchCode: code, cropId: body.cropId, startDate: d } });
    await tx.sample.createMany({ data: body.samples.map((s) => ({ ...s, collectedAt: new Date(s.collectedAt), batchId: batch.batchId })) });
    await makeTrays(tx, batch, first.stageId, body.benchId, body.bottles, null);
    return batch;
  });
  await audit(req.user!.userId, 'Started batch', `${batch.batchCode}, ${body.bottles} bottles`);
  res.status(201).json(batchOut(batch));
});

/** Moves the chosen trays into a new part of the batch (e.g. some go to rooting while the rest multiply). */
production.post('/batches/:id/split', manager, async (req, res) => {
  const batchId = idParam(req);
  const { trayIds } = parseBody(z.object({ trayIds: z.array(z.number().int().positive()).min(1, 'Choose the trays that go into the new part.') }), req.body);
  const child = await prisma.$transaction(async (tx) => {
    const parent = await tx.batch.findUnique({ where: { batchId } });
    if (!parent) throw new ApiError(404, 'Batch not found.');
    const active = await tx.tray.findMany({ where: { batchId, status: 'ACTIVE' }, select: { trayId: true } });
    const ids = new Set(active.map((t) => t.trayId));
    const picked = [...new Set(trayIds)];
    if (picked.some((id) => !ids.has(id))) throw new ApiError(400, 'Some chosen trays are not active trays of this batch.');
    if (picked.length >= active.length) throw new ApiError(400, 'Leave at least one tray in the original batch.');
    let letter = 65; // A
    while (await tx.batch.findUnique({ where: { batchCode: parent.batchCode + String.fromCharCode(letter) } })) letter++;
    const child = await tx.batch.create({
      data: { batchCode: parent.batchCode + String.fromCharCode(letter), cropId: parent.cropId, parentBatchId: batchId, startDate: dbDate(labToday()) },
    });
    await tx.tray.updateMany({ where: { trayId: { in: picked }, batchId }, data: { batchId: child.batchId, version: { increment: 1 } } });
    return child;
  });
  await audit(req.user!.userId, 'Split batch', `${child.batchCode} from batch ${batchId}, ${trayIds.length} trays`);
  res.status(201).json(batchOut(child));
});

production.post('/batches/:id/close', manager, async (req, res) => {
  const batchId = idParam(req);
  const b = await prisma.batch.findUnique({ where: { batchId } });
  if (!b) throw new ApiError(404, 'Batch not found.');
  if (await prisma.tray.count({ where: { batchId, status: 'ACTIVE' } })) throw new ApiError(409, 'The batch still has active trays.');
  await prisma.batch.update({ where: { batchId }, data: { status: 'CLOSED' } });
  await audit(req.user!.userId, 'Closed batch', b.batchCode);
  res.json({ ok: true });
});

// ---------- trays ----------
production.get('/trays', async (req, res) => {
  const scope = await scopeOf(req);
  const [lk, trays] = await Promise.all([loadLookups(), prisma.tray.findMany({ where: { status: 'ACTIVE', ...trayScopeWhere(scope) } })]);
  res.json(trays.map((t) => trayRow(t, lk)).sort((a, b) => a.qrCode.localeCompare(b.qrCode)));
});

production.get('/trays/qr/:code', async (req, res) => {
  const qr = String(req.params.code).trim();
  const t = await prisma.tray.findFirst({ where: { qrCode: { equals: qr, mode: 'insensitive' } } });
  if (!t) throw new ApiError(404, `No tray with code ${qr}.`);
  if (t.status !== 'ACTIVE') {
    const why = t.status === 'MOVED' ? 'sub-cultured into new trays' : t.status === 'SENT' ? 'all plants sent' : 'all bottles lost';
    throw new ApiError(409, `Tray ${t.qrCode} is no longer active (${why}).`);
  }
  const [scope, lk] = await Promise.all([scopeOf(req), loadLookups()]);
  if (!canSeeTray(scope, t, lk)) throw new ApiError(403, 'This tray is not in your zones.');
  res.json(trayRow(t, lk));
});

/** Trays by id, for printing QR labels (?ids=1,2,3). Only trays the user may see. */
production.get('/trays/by-ids', async (req, res) => {
  const ids = String(req.query.ids ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  const [scope, lk, trays] = await Promise.all([scopeOf(req), loadLookups(), prisma.tray.findMany({ where: { trayId: { in: ids } } })]);
  res.json(trays.filter((t) => canSeeTray(scope, t, lk)).map((t) => trayRow(t, lk)));
});

/** Trays on each bench right now, to warn when a bench is full. */
production.get('/trays/bench-load', async (_req, res) => {
  const rows = await prisma.tray.groupBy({ by: ['benchId'], where: { status: 'ACTIVE' }, _count: { _all: true } });
  res.json(Object.fromEntries(rows.map((r) => [r.benchId, r._count._all])));
});

/** Bottles handled per stage (from stage history plus bottles now on trays), used for loss %. */
production.get('/trays/handled-by-stage', async (_req, res) => {
  const [lk, moves, active] = await Promise.all([
    loadLookups(),
    prisma.trayMovement.groupBy({ by: ['fromStageId'], _sum: { bottlesIn: true } }),
    prisma.tray.groupBy({ by: ['stageId'], where: { status: 'ACTIVE' }, _sum: { bottleCount: true } }),
  ]);
  const out: Record<string, number> = {};
  const add = (stageId: number, n: number | null) => {
    const code = lk.stageById.get(stageId)?.code;
    if (code) out[code] = (out[code] ?? 0) + (n ?? 0);
  };
  for (const m of moves) add(m.fromStageId, m._sum.bottlesIn);
  for (const t of active) add(t.stageId, t._sum.bottleCount);
  res.json(out);
});

/** Sub-culture: the tray's bottles are cut and placed on fresh medium, giving new trays at the next (or same) stage. */
production.post('/trays/:id/subculture', async (req, res) => {
  const trayId = idParam(req);
  const body = parseBody(
    z.object({
      toStageId: z.number().int().positive(),
      toBenchId: z.number().int().positive(),
      bottlesOut: count('New bottles'),
      bottlesLost: count('Lost bottles'),
      mediaLotId: z.number().int().positive().nullable().optional(),
      cause: causes.nullish().transform((v) => v ?? undefined),
      contType: lossTypes.nullish().transform((v) => v ?? undefined),
    }),
    req.body,
  );
  const scope = await scopeOf(req);
  const user = req.user!;
  const today = labToday();

  const { made, lk, t } = await prisma.$transaction(async (tx) => {
    const lk = await loadLookups(tx);
    const t = await tx.tray.findUnique({ where: { trayId } });
    if (!t || t.status !== 'ACTIVE') throw new ApiError(404, 'Tray not found or not active.');
    if (!canSeeTray(scope, t, lk)) throw new ApiError(403, 'This tray is not in your zones.');
    const from = lk.stageById.get(t.stageId)!;
    const to = lk.stageById.get(body.toStageId);
    if (!to) throw new ApiError(400, 'Choose the stage the new bottles go to.');
    if (to.seqNo < from.seqNo) throw new ApiError(400, 'Bottles cannot go back to an earlier stage.');
    if (!lk.benchById.has(body.toBenchId)) throw new ApiError(400, 'Choose a bench for the new trays.');
    if (body.bottlesLost > t.bottleCount) throw new ApiError(400, `Lost bottles must be between 0 and ${t.bottleCount}.`);
    if (body.bottlesOut === 0 && body.bottlesLost !== t.bottleCount) throw new ApiError(400, 'Enter the new bottles made, or mark all bottles as lost.');
    const good = t.bottleCount - body.bottlesLost;
    if (body.bottlesOut > good * MAX_GROWTH)
      throw new ApiError(400, `${body.bottlesOut} new bottles from ${good} good bottles is more than ${MAX_GROWTH} times. Check the count (at most ${good * MAX_GROWTH}).`);
    if (body.bottlesLost > 0 && !(body.cause && body.contType)) throw new ApiError(400, 'Choose the cause and type of the loss.');
    await checkLot(tx, body.mediaLotId, to, body.bottlesOut);

    await updateTray(tx, t, { status: body.bottlesOut > 0 ? 'MOVED' : 'LOST' });
    const batch = lk.batchById.get(t.batchId)!;
    const made = await makeTrays(tx, batch, to.stageId, body.toBenchId, body.bottlesOut, body.mediaLotId ?? null);
    const cont = body.bottlesLost
      ? await tx.contamination.create({
          data: { trayId: t.trayId, bottlesLost: body.bottlesLost, cause: body.cause!, contType: body.contType!, foundOn: dbDate(today), reportedBy: user.userId, note: 'Found at sub-culture' },
        })
      : null;
    const move = await tx.trayMovement.create({
      data: {
        batchId: t.batchId, trayId: t.trayId, newTrayIds: made.map((m) => m.trayId), takenTrayIds: [], fromStageId: t.stageId, toStageId: to.stageId,
        fromBenchId: t.benchId, toBenchId: body.toBenchId, bottlesIn: t.bottleCount, bottlesOut: body.bottlesOut, bottlesLost: body.bottlesLost, movedBy: user.userId,
      },
    });
    // An operator's sub-culture becomes a work entry for the supervisor to check.
    if (user.role === 'OPERATOR') {
      const assign = await tx.workAssignment.findFirst({
        where: { operatorId: user.userId, workDate: dbDate(today), kind: 'SUBCULTURE', batchId: t.batchId, stageId: t.stageId },
      });
      await tx.productionEntry.create({
        data: {
          assignId: assign?.assignId ?? null, operatorId: user.userId, kind: 'SUBCULTURE', source: 'QR', trayId: t.trayId, batchId: t.batchId, stageId: t.stageId,
          areaId: assign?.areaId ?? user.homeAreaId, movementId: move.movementId, contId: cont?.contId ?? null, workDate: dbDate(today),
          bottlesHandled: t.bottleCount, bottlesProduced: body.bottlesOut, bottlesLost: body.bottlesLost, mediaLotId: body.mediaLotId ?? null,
        },
      });
    }
    return { made, lk, t };
  });
  await audit(user.userId, 'Sub-cultured tray', `${t.qrCode}: ${t.bottleCount} in, ${body.bottlesOut} out, ${body.bottlesLost} lost`);
  res.status(201).json(made.map((m) => trayRow(m, lk)));
});

/** Moves trays to another bench without changing their stage. */
production.post('/trays/move', requireRole('MANAGER', 'SUPERVISOR'), async (req, res) => {
  const body = parseBody(z.object({ trayIds: z.array(z.number().int().positive()).min(1, 'Choose at least one tray.').max(500), toBenchId: z.number().int().positive() }), req.body);
  const scope = await scopeOf(req);
  let moved = 0;
  await prisma.$transaction(async (tx) => {
    const lk = await loadLookups(tx);
    const bench = lk.benchById.get(body.toBenchId);
    if (!bench) throw new ApiError(400, 'Choose a bench.');
    if (scope.areas !== null && !scope.areas.includes(bench.areaId)) throw new ApiError(403, 'You can only move trays to benches in your zones.');
    const trays = await tx.tray.findMany({ where: { trayId: { in: body.trayIds } } });
    if (trays.length !== new Set(body.trayIds).size) throw new ApiError(400, 'Some trays were not found.');
    for (const t of trays) {
      if (t.status !== 'ACTIVE') throw new ApiError(409, `Tray ${t.qrCode} is no longer active.`);
      if (!canSeeTray(scope, t, lk)) throw new ApiError(403, `Tray ${t.qrCode} is not in your zones.`);
      if (t.benchId === body.toBenchId) continue;
      await updateTray(tx, t, { benchId: body.toBenchId });
      await tx.trayMovement.create({
        data: {
          batchId: t.batchId, trayId: t.trayId, newTrayIds: [t.trayId], takenTrayIds: [], fromStageId: t.stageId, toStageId: t.stageId,
          fromBenchId: t.benchId, toBenchId: body.toBenchId, bottlesIn: t.bottleCount, bottlesOut: t.bottleCount, bottlesLost: 0, movedBy: scope.userId,
        },
      });
      moved++;
    }
  });
  await audit(scope.userId, 'Moved trays', `${moved} trays to bench ${body.toBenchId}`);
  res.json({ ok: true, moved });
});

// ---------- losses ----------
production.post('/losses', async (req, res) => {
  const body = parseBody(
    z.object({
      trayId: z.number().int().positive(),
      bottlesLost: z.number().int().positive('Lost bottles must be at least 1.'),
      cause: causes,
      contType: lossTypes,
      foundOn: isoDay,
      note: z.string().trim().max(500).default(''),
    }),
    req.body,
  );
  if (body.foundOn > labToday()) throw new ApiError(400, 'The date cannot be in the future.');
  const scope = await scopeOf(req);
  const t = await prisma.$transaction(async (tx) => {
    const lk = await loadLookups(tx);
    const t = await tx.tray.findUnique({ where: { trayId: body.trayId } });
    if (!t || t.status !== 'ACTIVE') throw new ApiError(404, 'Tray not found or not active.');
    if (!canSeeTray(scope, t, lk)) throw new ApiError(403, 'This tray is not in your zones.');
    if (body.bottlesLost > t.bottleCount) throw new ApiError(400, `Lost bottles must be between 1 and ${t.bottleCount}.`);
    const left = t.bottleCount - body.bottlesLost;
    await updateTray(tx, t, { bottleCount: left, ...(left === 0 ? { status: 'LOST' as const } : {}) });
    await tx.contamination.create({ data: { ...body, foundOn: dbDate(body.foundOn), reportedBy: scope.userId } });
    return t;
  });
  await audit(scope.userId, 'Recorded loss', `${t.qrCode}: ${body.bottlesLost} bottles, ${body.cause}/${body.contType}`);
  res.status(201).json({ ok: true });
});

production.get('/losses', async (req, res) => {
  const scope = await scopeOf(req);
  const [lk, rows] = await Promise.all([
    loadLookups(),
    prisma.contamination.findMany({
      where: scope.areas === null ? {} : { tray: { bench: { areaId: { in: scope.areas } } } },
      include: { tray: true, reporter: { select: { fullName: true } } },
      orderBy: [{ foundOn: 'desc' }, { contId: 'desc' }],
    }),
  ]);
  res.json(rows.map((c) => lossOut(c, lk)));
});

// ---------- helpers ----------
type LossWith = Prisma.ContaminationGetPayload<{ include: { tray: true; reporter: { select: { fullName: true } } } }>;
function lossOut(c: LossWith, lk: Lookups) {
  const r = trayRow(c.tray, lk);
  return {
    contId: c.contId, trayId: c.trayId, bottlesLost: c.bottlesLost, cause: c.cause, contType: c.contType, foundOn: isoDate(c.foundOn),
    reportedBy: c.reportedBy, note: c.note, qrCode: r.qrCode, batchCode: r.batchCode, stageCode: r.stageCode, areaName: r.areaName, reportedByName: c.reporter.fullName,
  };
}

const moveOut = (m: TrayMovement) => ({ ...m, movedAt: m.movedAt.toISOString() });

/** Groups tray-level sub-cultures into one history line per stage change and day (bench moves are left out). */
function groupMoves(moves: TrayMovement[]): TrayMovement[] {
  const groups = new Map<string, TrayMovement>();
  for (const m of moves) {
    if (m.fromBenchId === null || (m.fromStageId === m.toStageId && m.bottlesOut === m.bottlesIn)) continue;
    const key = `${m.fromStageId}-${m.toStageId}-${labDate(m.movedAt)}`;
    const g = groups.get(key);
    if (g) {
      g.bottlesIn += m.bottlesIn;
      g.bottlesOut += m.bottlesOut;
      g.bottlesLost += m.bottlesLost;
    } else groups.set(key, { ...m, newTrayIds: [] });
  }
  return [...groups.values()];
}
