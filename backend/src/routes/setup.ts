// Lab set-up lists. Everyone signed in can read them; only the manager can change them.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { audit } from '../lib/audit.js';
import { idParam } from '../lib/params.js';
import { parseBody } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';

export const setup = Router();
setup.use(requireAuth);
const manager = requireRole('MANAGER');

const text = (label: string, max = 100) => z.string().trim().min(1, `${label} is required.`).max(max);
const phases = ['INITIATION', 'MULTIPLICATION', 'ROOTING', 'HARDENING'] as const;

// ---------- lab ----------
setup.get('/lab', async (_req, res) => {
  res.json(await prisma.lab.findFirstOrThrow({ orderBy: { labId: 'asc' } }));
});
setup.put('/lab', manager, async (req, res) => {
  const body = parseBody(z.object({ name: text('Lab name'), address: z.string().trim().max(300), phone: z.string().trim().max(30) }), req.body);
  const lab = await prisma.lab.findFirstOrThrow({ orderBy: { labId: 'asc' } });
  const saved = await prisma.lab.update({ where: { labId: lab.labId }, data: body });
  await audit(req.user!.userId, 'Changed lab details', body.name);
  res.json(saved);
});

// ---------- zones ----------
const areaBody = z.object({
  name: text('Zone name'),
  areaType: z.enum(['WASH', 'MEDIA', 'INOCULATION', 'INCUBATION', 'QC', 'HARDENING', 'STORE']),
  roomNo: z.string().trim().max(30).default(''),
});
setup.get('/areas', async (_req, res) => {
  res.json(await prisma.area.findMany({ orderBy: { areaId: 'asc' } }));
});
setup.post('/areas', manager, async (req, res) => {
  const body = parseBody(areaBody, req.body);
  const lab = await prisma.lab.findFirstOrThrow({ orderBy: { labId: 'asc' } });
  await sameNameCheck(lab.labId, body.name);
  const saved = await prisma.area.create({ data: { ...body, labId: lab.labId } });
  await audit(req.user!.userId, 'Saved zone', saved.name);
  res.status(201).json(saved);
});
setup.put('/areas/:id', manager, async (req, res) => {
  const areaId = idParam(req);
  const body = parseBody(areaBody, req.body);
  const old = await prisma.area.findUnique({ where: { areaId } });
  if (!old) throw new ApiError(404, 'Zone not found.');
  await sameNameCheck(old.labId, body.name, areaId);
  const saved = await prisma.area.update({ where: { areaId }, data: body });
  await audit(req.user!.userId, 'Saved zone', saved.name);
  res.json(saved);
});
setup.delete('/areas/:id', manager, async (req, res) => {
  const areaId = idParam(req);
  if (await prisma.bench.count({ where: { areaId } })) throw new ApiError(409, 'Remove the benches in this zone first.');
  const inUse = await prisma.user.count({ where: { status: 'ACTIVE', OR: [{ homeAreaId: areaId }, { zones: { some: { areaId } } }] } });
  if (inUse) throw new ApiError(409, 'Some active users work in this zone. Move them first.');
  const gone = await prisma.area.delete({ where: { areaId } });
  await audit(req.user!.userId, 'Deleted zone', gone.name);
  res.json({ ok: true });
});
async function sameNameCheck(labId: number, name: string, exceptId?: number) {
  const dup = await prisma.area.findFirst({ where: { labId, name: { equals: name, mode: 'insensitive' }, NOT: exceptId ? { areaId: exceptId } : undefined } });
  if (dup) throw new ApiError(409, 'A zone with this name already exists.');
}

// ---------- benches ----------
const benchBody = z.object({
  areaId: z.number().int().positive(),
  code: text('Bench code', 20).transform((s) => s.toUpperCase()),
  capacityTrays: z.number().int().positive('Capacity must be more than 0 trays.').max(10_000),
});
setup.get('/benches', async (req, res) => {
  const areaId = req.query.areaId ? Number(req.query.areaId) : undefined;
  res.json(await prisma.bench.findMany({ where: areaId ? { areaId } : {}, orderBy: { benchId: 'asc' } }));
});
setup.post('/benches', manager, async (req, res) => {
  const body = parseBody(benchBody, req.body);
  await benchCheck(body.areaId, body.code);
  const saved = await prisma.bench.create({ data: body });
  await audit(req.user!.userId, 'Saved bench', saved.code);
  res.status(201).json(saved);
});
setup.put('/benches/:id', manager, async (req, res) => {
  const benchId = idParam(req);
  const body = parseBody(benchBody, req.body);
  await benchCheck(body.areaId, body.code, benchId);
  const saved = await prisma.bench.update({ where: { benchId }, data: body });
  await audit(req.user!.userId, 'Saved bench', saved.code);
  res.json(saved);
});
setup.delete('/benches/:id', manager, async (req, res) => {
  const benchId = idParam(req);
  if (await prisma.tray.count({ where: { benchId, status: 'ACTIVE' } })) throw new ApiError(409, 'Trays are still on this bench. Move them first.');
  const gone = await prisma.bench.delete({ where: { benchId } });
  await audit(req.user!.userId, 'Deleted bench', gone.code);
  res.json({ ok: true });
});
async function benchCheck(areaId: number, code: string, exceptId?: number) {
  if (!(await prisma.area.findUnique({ where: { areaId } }))) throw new ApiError(400, 'Choose a zone for the bench.');
  const dup = await prisma.bench.findFirst({ where: { areaId, code: { equals: code, mode: 'insensitive' }, NOT: exceptId ? { benchId: exceptId } : undefined } });
  if (dup) throw new ApiError(409, 'This zone already has a bench with this code.');
}

// ---------- crops ----------
const cropBody = z.object({
  name: text('Crop name'),
  variety: text('Variety'),
  defaultGrowth: z.number().min(1, 'Growth per round should be between 1 and 6.').max(6, 'Growth per round should be between 1 and 6.'),
});
setup.get('/crops', async (_req, res) => {
  res.json(await prisma.crop.findMany({ orderBy: { cropId: 'asc' } }));
});
setup.post('/crops', manager, async (req, res) => {
  const body = parseBody(cropBody, req.body);
  await cropCheck(body.name, body.variety);
  const saved = await prisma.crop.create({ data: body });
  await audit(req.user!.userId, 'Saved crop', `${saved.name} ${saved.variety}`);
  res.status(201).json(saved);
});
setup.put('/crops/:id', manager, async (req, res) => {
  const cropId = idParam(req);
  const body = parseBody(cropBody, req.body);
  await cropCheck(body.name, body.variety, cropId);
  const saved = await prisma.crop.update({ where: { cropId }, data: body });
  await audit(req.user!.userId, 'Saved crop', `${saved.name} ${saved.variety}`);
  res.json(saved);
});
setup.delete('/crops/:id', manager, async (req, res) => {
  const cropId = idParam(req);
  if (await prisma.batch.count({ where: { cropId } })) throw new ApiError(409, 'Batches use this crop, so it cannot be removed.');
  const gone = await prisma.crop.delete({ where: { cropId } });
  await audit(req.user!.userId, 'Deleted crop', `${gone.name} ${gone.variety}`);
  res.json({ ok: true });
});
async function cropCheck(name: string, variety: string, exceptId?: number) {
  const dup = await prisma.crop.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, variety: { equals: variety, mode: 'insensitive' }, NOT: exceptId ? { cropId: exceptId } : undefined },
  });
  if (dup) throw new ApiError(409, 'This crop and variety already exist.');
}

// ---------- stages ----------
const stageBody = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,4}$/, 'Stage code: up to 4 letters or digits, e.g. M9.'),
    phase: z.enum(phases),
    seqNo: z.number().int().positive(),
    minDays: z.number().int().positive('Days: minimum must be above 0.'),
    maxDays: z.number().int().positive(),
  })
  .refine((s) => s.maxDays >= s.minDays, { message: 'Days: maximum must not be less than minimum.' });
setup.get('/stages', async (_req, res) => {
  res.json(await prisma.stage.findMany({ orderBy: { seqNo: 'asc' } }));
});
setup.post('/stages', manager, async (req, res) => {
  const body = parseBody(stageBody, req.body);
  await codeCheck('stage', body.code);
  const saved = await prisma.stage.create({ data: body });
  await audit(req.user!.userId, 'Saved stage', saved.code);
  res.status(201).json(saved);
});
setup.put('/stages/:id', manager, async (req, res) => {
  const stageId = idParam(req);
  const body = parseBody(stageBody, req.body);
  await codeCheck('stage', body.code, stageId);
  const saved = await prisma.stage.update({ where: { stageId }, data: body });
  await audit(req.user!.userId, 'Saved stage', saved.code);
  res.json(saved);
});
setup.delete('/stages/:id', manager, async (req, res) => {
  const stageId = idParam(req);
  if (await prisma.tray.count({ where: { stageId } })) throw new ApiError(409, 'Trays use this stage, so it cannot be removed.');
  const gone = await prisma.stage.delete({ where: { stageId } });
  await audit(req.user!.userId, 'Deleted stage', gone.code);
  res.json({ ok: true });
});

// ---------- media recipes (media codes) ----------
const recipeBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,8}$/, 'Media code: 2–8 letters, digits or dashes, e.g. MU-01.'),
  phase: z.enum(phases),
  shelfLifeDays: z.number().int().positive('Shelf life must be at least 1 day.').max(365),
  notes: z.string().trim().max(500).default(''),
});
setup.get('/recipes', async (_req, res) => {
  res.json(await prisma.mediaRecipe.findMany({ orderBy: { recipeId: 'asc' } }));
});
setup.post('/recipes', manager, async (req, res) => {
  const body = parseBody(recipeBody, req.body);
  await codeCheck('recipe', body.code);
  const saved = await prisma.mediaRecipe.create({ data: body });
  await audit(req.user!.userId, 'Saved media recipe', saved.code);
  res.status(201).json(saved);
});
setup.put('/recipes/:id', manager, async (req, res) => {
  const recipeId = idParam(req);
  const body = parseBody(recipeBody, req.body);
  await codeCheck('recipe', body.code, recipeId);
  const saved = await prisma.mediaRecipe.update({ where: { recipeId }, data: body });
  await audit(req.user!.userId, 'Saved media recipe', saved.code);
  res.json(saved);
});
setup.delete('/recipes/:id', manager, async (req, res) => {
  const recipeId = idParam(req);
  if (await prisma.mediaLot.count({ where: { recipeId } })) throw new ApiError(409, 'Media lots use this code, so it cannot be removed.');
  const gone = await prisma.mediaRecipe.delete({ where: { recipeId } });
  await audit(req.user!.userId, 'Deleted media recipe', gone.code);
  res.json({ ok: true });
});

async function codeCheck(kind: 'stage' | 'recipe', code: string, exceptId?: number) {
  const dup =
    kind === 'stage'
      ? await prisma.stage.findFirst({ where: { code: { equals: code, mode: 'insensitive' }, NOT: exceptId ? { stageId: exceptId } : undefined } })
      : await prisma.mediaRecipe.findFirst({ where: { code: { equals: code, mode: 'insensitive' }, NOT: exceptId ? { recipeId: exceptId } : undefined } });
  if (dup) throw new ApiError(409, `This ${kind === 'stage' ? 'stage' : 'media'} code already exists.`);
}

// ---------- alert limits ----------
setup.get('/alert-rules', async (_req, res) => {
  res.json(await prisma.alertRule.findMany({ orderBy: { ruleId: 'asc' } }));
});
setup.put('/alert-rules/:id', manager, async (req, res) => {
  const ruleId = idParam(req);
  const body = parseBody(z.object({ warnValue: z.number(), criticalValue: z.number().nullable() }), req.body);
  const rule = await prisma.alertRule.findUnique({ where: { ruleId } });
  if (!rule) throw new ApiError(404, 'Rule not found.');
  if (body.criticalValue !== null) {
    const ok = rule.direction === 'ABOVE' ? body.criticalValue >= body.warnValue : body.criticalValue <= body.warnValue;
    if (!ok)
      throw new ApiError(400, rule.direction === 'ABOVE' ? 'Critical limit must be the same as or above the warning limit.' : 'Critical limit must be the same as or below the warning limit.');
  }
  const saved = await prisma.alertRule.update({ where: { ruleId }, data: body });
  await audit(req.user!.userId, 'Changed alert limit', `${saved.code}: warn ${saved.warnValue}, critical ${saved.criticalValue ?? '-'}`);
  res.json(saved);
});

// ---------- forecast settings ----------
const share = z.number().min(0, 'Use a share between 0 and 1.').max(1, 'Use a share between 0 and 1.');
setup.get('/settings', async (_req, res) => {
  const s = await prisma.settings.findUniqueOrThrow({ where: { settingsId: 1 } });
  res.json({ rootingSurvival: s.rootingSurvival, hardeningSurvival: s.hardeningSurvival, lastMultiplicationStage: s.lastMultiplicationStage, defaultRate: s.defaultRate ?? undefined });
});
setup.put('/settings', manager, async (req, res) => {
  const body = parseBody(
    z.object({ rootingSurvival: share, hardeningSurvival: share, lastMultiplicationStage: z.string().trim().toUpperCase(), defaultRate: z.number().positive().nullable().optional() }),
    req.body,
  );
  if (!(await prisma.stage.findUnique({ where: { code: body.lastMultiplicationStage } }))) throw new ApiError(400, `Stage ${body.lastMultiplicationStage} is not in the stage list.`);
  const s = await prisma.settings.update({ where: { settingsId: 1 }, data: { ...body, defaultRate: body.defaultRate ?? null } });
  await audit(req.user!.userId, 'Changed forecast assumptions', `rooting ${s.rootingSurvival}, hardening ${s.hardeningSurvival}`);
  res.json({ rootingSurvival: s.rootingSurvival, hardeningSurvival: s.hardeningSurvival, lastMultiplicationStage: s.lastMultiplicationStage, defaultRate: s.defaultRate ?? undefined });
});
