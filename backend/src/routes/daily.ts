// Daily work: attendance, giving work, recording work, checking entries and output totals.
// The rules live in services/daily.ts; this file checks the request and who may call it.
import { Router, type Request } from 'express';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { isIsoDate, labToday } from '../lib/dates.js';
import { idParam } from '../lib/params.js';
import { parseBody } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import * as D from '../services/daily.js';

export const daily = Router();
daily.use(requireAuth);
const staff = requireRole('MANAGER', 'SUPERVISOR');
const operator = requireRole('OPERATOR');

const isoDay = z.string().refine(isIsoDate, 'Use a date like 2026-11-25.');
const kinds = z.enum(['SUBCULTURE', 'WASH', 'MEDIA', 'QC_MEDIA', 'QC_CULTURE']);
const whole = (label: string) => z.number({ error: `${label} must be a number.` }).int(`${label} must be a whole number.`).min(0, `${label} cannot be negative.`).max(1_000_000);
const id = z.number().int().positive();
/** Optional field: missing and null both mean "not given". */
const opt = <T extends z.ZodType>(t: T) => t.nullish().transform((v) => (v ?? undefined) as z.infer<T> | undefined);

/** ?date=YYYY-MM-DD, or today in the lab. */
function dateQuery(req: Request, name = 'date'): string {
  const v = req.query[name];
  if (v === undefined || v === '') return labToday();
  if (typeof v !== 'string' || !isIsoDate(v)) throw new ApiError(400, `${name} must be a date like 2026-11-25.`);
  return v;
}
/** Optional ?name=123 */
function idQuery(req: Request, name: string): number | undefined {
  const v = req.query[name];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `${name} must be a positive whole number.`);
  return n;
}

// ---------- attendance ----------
daily.get('/attendance', staff, async (req, res) => {
  res.json(D.getAttendance(await D.loadCtx(), D.meOf(req), dateQuery(req)));
});

daily.post('/attendance', staff, async (req, res) => {
  const body = parseBody(
    z.object({ date: isoDay, marks: z.array(z.object({ userId: id, status: z.enum(['P', 'HD', 'A']) })).min(1, 'Mark at least one person.').max(500) }),
    req.body,
  );
  const me = D.meOf(req);
  await D.change((tx, c) => D.markAttendance(tx, c, me, body.date, body.marks));
  await audit(me.userId, 'Marked attendance', `${body.date}: ${body.marks.length} people`);
  res.json({ ok: true });
});

/** An operator's own attendance for one month (?month=YYYY-MM, default this month). */
daily.get('/my-attendance', async (req, res) => {
  const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : labToday().slice(0, 7);
  const c = await D.loadCtx();
  const me = D.meOf(req);
  res.json(c.atts.filter((a) => a.userId === me.userId && a.workDate.startsWith(month)).sort((a, b) => a.workDate.localeCompare(b.workDate)));
});

daily.get('/today-attendance', async (req, res) => {
  const c = await D.loadCtx();
  const d = labToday();
  res.json({ status: c.atts.find((a) => a.userId === req.user!.userId && a.workDate === d)?.status ?? null });
});

// ---------- giving work ----------
daily.get('/assign-options', async (req, res) => {
  res.json(D.assignOptions(await D.loadCtx(), D.meOf(req), dateQuery(req)));
});

daily.get('/assignments', async (req, res) => {
  res.json(D.listAssignments(await D.loadCtx(), D.meOf(req), dateQuery(req)));
});

const assignBody = z.object({
  workDate: isoDay,
  operatorId: id,
  kind: kinds.default('SUBCULTURE'),
  areaId: id.nullable().optional(),
  batchId: id.nullable().optional(),
  stageId: id.nullable().optional(),
  batchCode: opt(z.string().max(40)),
  stageCode: opt(z.string().max(10)),
  cropId: id.nullable().optional(),
  benchId: id.nullable().default(null),
  targetBottles: whole('Target'),
  targetContaminated: opt(whole('Contaminated target')),
  recipeId: id.nullable().optional(),
  mediaBatchCode: opt(z.string().max(40)),
});

daily.post('/assignments', staff, async (req, res) => {
  const body = parseBody(assignBody, req.body);
  const me = D.meOf(req);
  const row = await D.change((tx, c) => D.saveAssignment(tx, c, me, body));
  await audit(me.userId, 'Gave work', `${row.operatorName}: ${row.label}, ${row.target} bottles on ${row.workDate}`);
  res.status(201).json(row);
});

daily.put('/assignments/:id', staff, async (req, res) => {
  const assignId = idParam(req);
  const body = parseBody(assignBody, req.body);
  const me = D.meOf(req);
  const row = await D.change((tx, c) => D.saveAssignment(tx, c, me, { ...body, assignId }));
  await audit(me.userId, 'Gave work', `${row.operatorName}: ${row.label}, ${row.target} bottles on ${row.workDate} (changed)`);
  res.json(row);
});

daily.delete('/assignments/:id', staff, async (req, res) => {
  const assignId = idParam(req);
  const me = D.meOf(req);
  await D.change((tx, c) => D.deleteAssignment(tx, c, me, assignId));
  await audit(me.userId, 'Removed work', `line ${assignId}`);
  res.json({ ok: true });
});

daily.post('/assignments/copy-previous', staff, async (req, res) => {
  const { date } = parseBody(z.object({ date: isoDay }), req.body);
  const me = D.meOf(req);
  const added = await D.change((tx, c) => D.copyPreviousDay(tx, c, me, date));
  await audit(me.userId, 'Copied previous day’s work', `${added} lines to ${date}`);
  res.json({ added });
});

// ---------- board ----------
daily.get('/board', staff, async (req, res) => {
  res.json(D.dailyBoard(await D.loadCtx(), D.meOf(req), dateQuery(req), idQuery(req, 'areaId')));
});

// ---------- work done ----------
daily.get('/entry-options', async (req, res) => {
  const me = D.meOf(req);
  const operatorId = idQuery(req, 'operatorId') ?? me.userId;
  res.json(D.entryOptions(await D.loadCtx(), me, dateQuery(req), operatorId));
});

daily.get('/bottles-at', async (req, res) => {
  const batchId = idQuery(req, 'batchId');
  const stageId = idQuery(req, 'stageId');
  if (!batchId || !stageId) throw new ApiError(400, 'batchId and stageId are required.');
  const c = await D.loadCtx();
  const ts = D.helpers(c).traysFor(batchId, stageId, D.meOf(req));
  res.json({ bottles: ts.reduce((n, t) => n + t.bottleCount, 0), trays: ts.length });
});

daily.post('/entries', async (req, res) => {
  const body = parseBody(
    z.object({
      operatorId: id,
      workDate: isoDay,
      assignId: id.nullable().optional(),
      kind: kinds,
      areaId: id.nullable().optional(),
      bottlesHandled: whole('Bottles'),
      batchId: id.nullable().optional(),
      stageId: id.nullable().optional(),
      batchCode: opt(z.string().max(40)),
      stageCode: opt(z.string().max(10)),
      cropId: id.nullable().optional(),
      bottlesOut: opt(whole('New bottles')),
      bottlesLost: opt(whole('Lost bottles')),
      toStageId: opt(id),
      toBenchId: opt(id),
      mediaLotId: id.nullable().optional(),
      cause: opt(z.enum(['LAB', 'OPERATOR', 'SEASON', 'MEDIA'])),
      contType: opt(z.enum(['FUNGAL', 'BACTERIAL', 'OTHER'])),
      contaminated: opt(whole('Contaminated bottles')),
      recipeId: id.nullable().optional(),
      mediaBatchCode: opt(z.string().max(40)),
      litres: opt(z.number().min(0).max(10_000)),
      note: opt(z.string().max(500)),
    }),
    req.body,
  );
  const me = D.meOf(req);
  const row = await D.change(async (tx, c) => {
    const e = await D.enterWork(tx, c, me, body);
    return D.helpers(c).entryRow(e);
  });
  await audit(me.userId, 'Entered work done', `${row.operatorName}: ${row.label}, ${row.bottlesHandled} bottles on ${row.workDate}`);
  res.status(201).json(row);
});

daily.get('/entries', async (req, res) => {
  const status = req.query.status;
  if (status !== undefined && !['PENDING', 'VERIFIED', 'REJECTED'].includes(String(status))) throw new ApiError(400, 'status must be PENDING, VERIFIED or REJECTED.');
  const from = req.query.from ? dateQuery(req, 'from') : undefined;
  const to = req.query.to ? dateQuery(req, 'to') : undefined;
  res.json(D.listEntries(await D.loadCtx(), D.meOf(req), { status: status as 'PENDING' | 'VERIFIED' | 'REJECTED' | undefined, from, to }));
});

daily.post('/entries/verify', staff, async (req, res) => {
  const { entryIds } = parseBody(z.object({ entryIds: z.array(id).min(1, 'Choose at least one entry.').max(1000) }), req.body);
  const me = D.meOf(req);
  await D.change((tx, c) => D.verifyEntries(tx, c, me, entryIds));
  await audit(me.userId, 'Verified entries', `${entryIds.length} entries`);
  res.json({ ok: true });
});

daily.post('/entries/:id/reject', staff, async (req, res) => {
  const entryId = idParam(req);
  const { reason } = parseBody(z.object({ reason: z.string().max(500) }), req.body);
  const me = D.meOf(req);
  const r = await D.change((tx, c) => D.rejectEntry(tx, c, me, entryId, reason));
  await audit(me.userId, 'Sent entry back', `entry ${entryId}${r.undone ? ' (undone)' : ''}: ${reason.trim()}`);
  res.json(r);
});

// ---------- output ----------
daily.get('/output', async (req, res) => {
  const kind = req.query.kind ? kinds.safeParse(req.query.kind) : undefined;
  if (kind && !kind.success) throw new ApiError(400, 'kind is not a kind of work.');
  const to = dateQuery(req, 'to');
  const from = req.query.from ? dateQuery(req, 'from') : to;
  res.json(
    D.workOutput(await D.loadCtx(), D.meOf(req), {
      from, to, kind: kind?.data,
      operatorId: idQuery(req, 'operatorId'), areaId: idQuery(req, 'areaId'), batchId: idQuery(req, 'batchId'), stageId: idQuery(req, 'stageId'),
    }),
  );
});

daily.get('/my-output', operator, async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
  res.json(D.myOutput(await D.loadCtx(), D.meOf(req), days));
});

daily.get('/my-sent-back', operator, async (req, res) => {
  res.json(D.mySentBack(await D.loadCtx(), D.meOf(req)));
});

daily.get('/wash', async (_req, res) => {
  const c = await D.loadCtx();
  const h = D.helpers(c);
  res.json({ ...h.washPool(), addedToday: h.washAddedOn(labToday()) });
});
