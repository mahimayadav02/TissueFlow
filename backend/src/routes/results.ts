// Stock and media, monthly costs, orders, forecast, alerts, room monitoring, reports, audit log, zones,
// and the sensor node's readings. Rules live in services/ops.ts, services/results.ts and services/lab.ts.
import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { audit } from '../lib/audit.js';
import { isIsoDate, labToday } from '../lib/dates.js';
import { idParam } from '../lib/params.js';
import { hashToken, newToken } from '../lib/tokens.js';
import { parseBody } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import type { Prisma } from '@prisma/client';
import { locked, meOf } from '../services/daily.js';
import { evaluateAlerts, loadLab, money, type Lab } from '../services/lab.js';
import * as O from '../services/ops.js';
import * as R from '../services/results.js';

export const results = Router();
const staff = requireRole('MANAGER', 'SUPERVISOR');
const manager = requireRole('MANAGER');

const isoDay = z.string().refine(isIsoDate, 'Use a date like 2026-11-25.');
const monthRe = /^\d{4}-\d{2}$/;
function monthQuery(req: Request) {
  const m = typeof req.query.month === 'string' ? req.query.month : labToday().slice(0, 7);
  if (!monthRe.test(m)) throw new ApiError(400, 'month must look like 2026-11.');
  return m;
}
const daysQuery = (req: Request, dflt: number, max: number) => Math.min(max, Math.max(1, Number(req.query.days) || dflt));

/** Loads the lab for one change, inside the same lock as daily work (stock, trays and orders interact). */
const changeLab = <T>(fn: (tx: Prisma.TransactionClient, L: Lab) => Promise<T>) => locked(async (tx) => fn(tx, await loadLab(tx)));

// ---------------------------------------------------------------- sensor node (no sign-in: device key)
/** The ESP32 node posts a reading with its device key in the X-Device-Key header. */
results.post('/iot/readings', async (req, res) => {
  const key = req.get('x-device-key') ?? '';
  if (key.length < 20) throw new ApiError(401, 'Device key missing.');
  const dev = await prisma.sensorDevice.findFirst({ where: { apiKeyHash: hashToken(key) } });
  if (!dev) throw new ApiError(401, 'Unknown device key.');
  const body = parseBody(
    z.object({
      tempC: z.number().min(-20).max(70),
      humidityPct: z.number().min(0).max(100),
      lightLux: z.number().min(0).max(200_000).optional(),
      recordedAt: z.string().datetime().optional(),
    }),
    req.body,
  );
  const at = body.recordedAt ? new Date(body.recordedAt) : new Date();
  if (at.getTime() > Date.now() + 5 * 60_000) throw new ApiError(400, 'recordedAt is in the future.');
  await prisma.sensorReading.create({ data: { deviceId: dev.deviceId, recordedAt: at, tempC: body.tempC, humidityPct: body.humidityPct, lightLux: body.lightLux ?? null } });
  // Room limits are checked as soon as a reading arrives.
  await evaluateAlerts(await loadLab(), true);
  res.status(201).json({ ok: true });
});

results.use(requireAuth);

results.get('/iot/devices', manager, async (_req, res) => {
  const devs = await prisma.sensorDevice.findMany({ orderBy: { deviceId: 'asc' }, include: { area: { select: { name: true } }, _count: { select: { readings: true } } } });
  res.json(devs.map((d) => ({ deviceId: d.deviceId, name: d.name, areaId: d.areaId, areaName: d.area.name, intervalMin: d.intervalMin, hasKey: !!d.apiKeyHash, readings: d._count.readings })));
});

/** Makes a new key for a device and shows it once. The old key stops working. */
results.post('/iot/devices/:id/key', manager, async (req, res) => {
  const deviceId = idParam(req);
  const key = newToken();
  await prisma.sensorDevice.update({ where: { deviceId }, data: { apiKeyHash: hashToken(key) } });
  await audit(req.user!.userId, 'Made new device key', `device ${deviceId}`);
  res.json({ deviceId, key, note: 'Copy this key into the sensor node now. It is not shown again.' });
});

// ---------------------------------------------------------------- stock and media (manager, supervisors)
results.get('/stock/items', staff, async (_req, res) => res.json(O.listItems(await loadLab())));

const itemBody = z.object({
  name: z.string().max(100),
  category: z.enum(['CHEMICAL', 'CONSUMABLE', 'HARDENING', 'OTHER']),
  unit: z.string().max(20),
  stockQty: z.number().min(0).max(1e9).default(0),
  reorderLevel: z.number().max(1e9),
});
results.post('/stock/items', staff, async (req, res) => {
  const body = parseBody(itemBody, req.body);
  const me = meOf(req);
  const row = await changeLab((tx, L) => O.saveItem(tx, L, me, body));
  await audit(me.userId, 'Saved stock item', `${row.name}, new`);
  res.status(201).json(row);
});
results.put('/stock/items/:id', staff, async (req, res) => {
  const itemId = idParam(req);
  const body = parseBody(itemBody, req.body);
  const me = meOf(req);
  const row = await changeLab((tx, L) => O.saveItem(tx, L, me, { ...body, itemId }));
  await audit(me.userId, 'Saved stock item', row.name);
  res.json(row);
});

results.post('/stock/moves', staff, async (req, res) => {
  const body = parseBody(z.object({ itemId: z.number().int().positive(), type: z.enum(['IN', 'OUT', 'ADJ']), qty: z.number().max(1e9), note: z.string().max(300).default('') }), req.body);
  const me = meOf(req);
  const r = await changeLab((tx, L) => O.stockMove(tx, L, me, body.itemId, body.type, body.qty, body.note));
  await audit(me.userId, 'Changed stock', `${r.item}: ${body.type} ${body.qty}${body.note ? ` (${body.note.trim()})` : ''}`);
  res.status(201).json({ ok: true });
});

results.get('/stock/txns', staff, async (req, res) => res.json(O.listTxns(await loadLab(), daysQuery(req, 30, 366))));

results.get('/media/lots', async (req, res) => res.json(O.listMediaLots(await loadLab(), daysQuery(req, 30, 366))));

results.get('/media/usable', async (req, res) => {
  const phase = z.enum(['INITIATION', 'MULTIPLICATION', 'ROOTING', 'HARDENING']).safeParse(req.query.phase);
  if (!phase.success) throw new ApiError(400, 'phase must be INITIATION, MULTIPLICATION, ROOTING or HARDENING.');
  res.json(O.usableLots(await loadLab(), phase.data));
});

results.post('/media/lots', staff, async (req, res) => {
  const body = parseBody(
    z.object({
      recipeId: z.number().int().positive(),
      lotCode: z.string().max(40).optional(),
      preparedOn: isoDay,
      volumeLitre: z.number().max(10_000),
      bottlesFilled: z.number().max(1_000_000),
      used: z.array(z.object({ itemId: z.number().int().positive(), qty: z.number().min(0).max(1e9) })).max(50).default([]),
    }),
    req.body,
  );
  const me = meOf(req);
  const lot = await changeLab((tx, L) => O.createMediaLot(tx, L, me, body));
  await audit(me.userId, 'Made media lot', `${lot.lotCode}: ${lot.bottlesFilled} bottles`);
  res.status(201).json(lot);
});

// ---------------------------------------------------------------- monthly costs (manager)
results.get('/costs/month', manager, async (req, res) => res.json(O.getMonth(await loadLab(), monthQuery(req))));

results.put('/costs/month', manager, async (req, res) => {
  const amount = z.number().max(1e10).optional();
  const body = parseBody(
    z.object({
      month: z.string().regex(monthRe, 'Choose a month.'),
      amounts: z.object({ LABOUR: amount, CHEMICALS: amount, CONSUMABLES: amount, POWER: amount, HARDENING: amount, OTHER: amount }).strict(),
    }),
    req.body,
  );
  const me = meOf(req);
  const amounts = Object.fromEntries(Object.entries(body.amounts).filter(([, v]) => v !== undefined)) as Record<string, number>;
  await changeLab((tx, L) => O.saveMonthCosts(tx, L, me, body.month, amounts));
  await audit(me.userId, 'Saved monthly costs', `${body.month}: ${Object.entries(amounts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  res.json({ ok: true });
});

results.get('/costs/history', manager, async (req, res) => res.json(O.monthHistory(await loadLab(), Math.min(24, Math.max(1, Number(req.query.count) || 6)))));
results.get('/costs/batches', manager, async (_req, res) => res.json(O.batchCosts(await loadLab())));

// ---------------------------------------------------------------- orders (manager)
const orderBody = z.object({
  customerName: z.string().max(200),
  phone: z.string().trim().max(20).default(''),
  cropId: z.number().int().positive(),
  plantsOrdered: z.number().max(1e9),
  ratePerPlant: z.number().max(1e6),
  requiredBy: isoDay,
});

results.get('/orders', manager, async (_req, res) => res.json(O.listOrders(await loadLab())));

/** "Can we deliver by this date?" Does not save anything. */
results.post('/orders/check', manager, async (req, res) => {
  const body = parseBody(orderBody.extend({ excludeOrderId: z.number().int().positive().optional() }), req.body);
  const { excludeOrderId, ...input } = body;
  res.json(O.checkOrder(await loadLab(), input, excludeOrderId));
});

results.post('/orders', manager, async (req, res) => {
  const body = parseBody(orderBody, req.body);
  const me = meOf(req);
  const o = await changeLab((tx, L) => O.createOrder(tx, L, me, body));
  await audit(me.userId, 'Created order', `${o.orderCode}: ${o.customerName}, ${o.plantsOrdered} plants, ${o.decision}`);
  res.status(201).json({ ...o, ratePerPlant: Number(o.ratePerPlant) });
});

results.post('/orders/:id/recheck', manager, async (req, res) => {
  const orderId = idParam(req);
  const c = await changeLab((tx, L) => O.recheckOrder(tx, L, orderId));
  await audit(req.user!.userId, 'Checked order again', `order ${orderId}: ${c.decision}`);
  res.json(c);
});

results.post('/orders/:id/cancel', manager, async (req, res) => {
  const orderId = idParam(req);
  const o = await changeLab((tx, L) => O.cancelOrder(tx, L, orderId));
  await audit(req.user!.userId, 'Cancelled order', o.orderCode);
  res.json({ ok: true });
});

results.get('/orders/hardened-stock', manager, async (req, res) => {
  const cropId = Number(req.query.cropId);
  if (!Number.isInteger(cropId) || cropId <= 0) throw new ApiError(400, 'cropId is required.');
  res.json(O.hardenedStock(await loadLab(), cropId));
});

results.post('/orders/:id/deliveries', manager, async (req, res) => {
  const orderId = idParam(req);
  const body = parseBody(z.object({ batchId: z.number().int().positive(), plants: z.number().max(1e9), sentOn: isoDay }), req.body);
  const me = meOf(req);
  const r = await changeLab((tx, L) => O.recordDelivery(tx, L, me, orderId, body.batchId, body.plants, body.sentOn));
  await audit(me.userId, 'Recorded plants sent', `${r.orderCode}: ${body.plants} plants from ${r.batchCode} on ${body.sentOn}`);
  res.status(201).json({ ok: true });
});

// ---------------------------------------------------------------- forecast (manager)
results.get('/forecast', manager, async (_req, res) => {
  const L = await loadLab();
  res.json({ rows: R.forecastRows(L), costPerBottle: money(L).rateFor(labToday().slice(0, 7)) });
});

// ---------------------------------------------------------------- alerts
results.get('/alerts', async (req, res) => {
  const L = await loadLab();
  await evaluateAlerts(L);
  res.json(R.listAlerts(L, meOf(req)));
});

results.post('/alerts/acknowledge', staff, async (req, res) => {
  const { alertIds } = parseBody(z.object({ alertIds: z.array(z.number().int().positive()).min(1, 'Choose at least one alert.').max(1000) }), req.body);
  const me = meOf(req);
  await prisma.$transaction((tx) => R.acknowledgeAlerts(tx, me, alertIds));
  await audit(me.userId, 'Acknowledged alerts', `${alertIds.length} alerts`);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- dashboard, room, reports, audit
results.get('/dashboard', manager, async (_req, res) => {
  const L = await loadLab();
  await evaluateAlerts(L);
  res.json(await R.dashboard(L));
});

results.get('/room', staff, async (req, res) => {
  const hours = Math.min(24 * 31, Math.max(1, Number(req.query.hours) || 24));
  const L = await loadLab();
  await evaluateAlerts(L);
  res.json(await R.room(L, meOf(req), hours));
});

results.get('/reports/month', staff, async (req, res) => res.json(await R.monthReport(await loadLab(), meOf(req), monthQuery(req))));

results.get('/reports/day', staff, async (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : labToday();
  if (!isIsoDate(date)) throw new ApiError(400, 'date must look like 2026-11-25.');
  res.json(R.dayReport(await loadLab(), meOf(req), date));
});

results.get('/audit', manager, async (req, res) => res.json(await R.listAudit(daysQuery(req, 30, 366))));

// ---------------------------------------------------------------- zones (manager, supervisors)
results.get('/zones', staff, async (req, res) => {
  const L = await loadLab();
  await evaluateAlerts(L);
  const date = typeof req.query.date === 'string' && isIsoDate(req.query.date) ? req.query.date : labToday();
  res.json(await R.zoneSummaries(L, meOf(req), date));
});

results.get('/zones/:id', staff, async (req, res) => {
  const areaId = idParam(req);
  const L = await loadLab();
  await evaluateAlerts(L);
  const date = typeof req.query.date === 'string' && isIsoDate(req.query.date) ? req.query.date : labToday();
  res.json(await R.zoneDetail(L, meOf(req), areaId, date));
});
