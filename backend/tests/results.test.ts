// Stock, media, costs, orders, forecast, alerts, room, reports, audit, zones and the sensor node, against the
// real database. Everything made here is removed and every changed row is put back. Run: npm test
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '../src/db/prisma.js';
import { PHONES, base, call, rand, start, stop, tokenFor } from './helpers.js';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

let mgr = '', asha = '', supA = '', supB = '';
const made = { itemIds: [] as number[], lotIds: [] as number[], orderIds: [] as number[], deviceKeys: [] as number[] };
const traysBefore: { trayId: number; bottleCount: number; status: 'ACTIVE' | 'MOVED' | 'LOST' | 'SENT'; version: number }[] = [];
let ackedAlert: number | null = null;

before(async () => {
  await start();
  [mgr, asha, supA, supB] = await Promise.all([PHONES.manager, PHONES.asha, PHONES.supervisorA, PHONES.supervisorB].map((p) => tokenFor(p)));
});
after(async () => {
  await prisma.delivery.deleteMany({ where: { orderId: { in: made.orderIds } } });
  await prisma.salesOrder.deleteMany({ where: { orderId: { in: made.orderIds } } });
  for (const t of traysBefore) await prisma.tray.update({ where: { trayId: t.trayId }, data: { bottleCount: t.bottleCount, status: t.status, version: t.version } });
  await prisma.stockTxn.deleteMany({ where: { OR: [{ itemId: { in: made.itemIds } }, { mediaLotId: { in: made.lotIds } }] } });
  await prisma.mediaLot.deleteMany({ where: { mediaLotId: { in: made.lotIds } } });
  await prisma.item.deleteMany({ where: { itemId: { in: made.itemIds } } });
  await prisma.costEntry.deleteMany({ where: { month: '2020-01' } });
  if (ackedAlert) await prisma.alert.update({ where: { alertId: ackedAlert }, data: { ackAt: null, ackBy: null } });
  for (const deviceId of made.deviceKeys) {
    await prisma.sensorReading.deleteMany({ where: { deviceId } });
    await prisma.sensorDevice.update({ where: { deviceId }, data: { apiKeyHash: null } });
  }
  await stop();
});

test('stock: add an item, receive, use, count; operators have no access', async () => {
  assert.equal((await call('/stock/items', { token: asha })).status, 403);
  const name = `Test item ${rand()}`;
  const r = await call('/stock/items', { token: supA, body: { name, category: 'CHEMICAL', unit: 'kg', stockQty: 10, reorderLevel: 2 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  made.itemIds.push(r.body.itemId);
  assert.equal((await call('/stock/items', { token: supA, body: { name: name.toUpperCase(), category: 'CHEMICAL', unit: 'kg', stockQty: 0, reorderLevel: 1 } })).status, 409);
  const move = (type: string, qty: number, note = '') => call('/stock/moves', { token: supA, body: { itemId: r.body.itemId, type, qty, note } });
  assert.equal((await move('IN', 5)).status, 201);
  assert.equal((await move('OUT', 3)).status, 201);
  assert.match((await move('OUT', 100)).body.error, /Only 12 kg in stock/);
  assert.match((await move('ADJ', 11)).body.error, /Write why/);
  assert.equal((await move('ADJ', 11, 'spilled')).status, 201);
  const items = await call('/stock/items', { token: supA });
  assert.equal(items.body.find((i: any) => i.itemId === r.body.itemId).stockQty, 11);
  const txns = await call('/stock/txns', { token: supA });
  assert.equal(txns.body.filter((t: any) => t.itemId === r.body.itemId).length, 4, 'opening stock, in, out and the count');
});

test('media lot: takes chemicals out of stock; its code must be new', async () => {
  const item = made.itemIds[0];
  const code = `TEST-${rand()}`;
  const body = { recipeId: 1, lotCode: code, preparedOn: today, volumeLitre: 5, bottlesFilled: 100, used: [{ itemId: item, qty: 1.5 }] };
  const r = await call('/media/lots', { token: supA, body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  made.lotIds.push(r.body.mediaLotId);
  assert.equal(r.body.lotCode, code);
  assert.match((await call('/media/lots', { token: supA, body })).body.error, /already used/);
  const stock = await prisma.item.findUniqueOrThrow({ where: { itemId: item } });
  assert.equal(stock.stockQty, 9.5);
  const lots = await call('/media/lots', { token: asha });
  const row = lots.body.find((l: any) => l.mediaLotId === r.body.mediaLotId);
  assert.equal(row.state, 'USABLE');
  assert.equal(row.bottlesLeft, 100);
  const usable = await call('/media/usable?phase=MULTIPLICATION', { token: asha });
  assert.ok(usable.body.some((l: any) => l.mediaLotId === r.body.mediaLotId));
});

test('monthly costs: manager only; cost per bottle follows the month', async () => {
  assert.equal((await call('/costs/month?month=2020-01', { token: supA })).status, 403);
  assert.equal((await call('/costs/month', { token: mgr, method: 'PUT', body: { month: '2020-01', amounts: { LABOUR: 1000, POWER: 250 } } })).status, 200);
  const m = await call('/costs/month?month=2020-01', { token: mgr });
  assert.equal(m.body.totalCost, 1250);
  assert.equal(m.body.costPerBottle, null, 'no bottles were handled in that month');
  assert.match((await call('/costs/month', { token: mgr, method: 'PUT', body: { month: '2099-01', amounts: { LABOUR: 1 } } })).body.error, /future month/);
  assert.equal((await call('/costs/month', { token: mgr, method: 'PUT', body: { month: '2020-01', amounts: { POWER: 0 } } })).status, 200);
  assert.equal((await call('/costs/month?month=2020-01', { token: mgr })).body.totalCost, 1000, 'a 0 amount removes that heading');
  assert.equal((await call('/costs/history', { token: mgr })).status, 200);
  assert.equal((await call('/costs/batches', { token: mgr })).status, 200);
});

test('orders: check, create, check again, send plants from hardening, cancel', async () => {
  const stock = await call('/orders/hardened-stock?cropId=1', { token: mgr });
  assert.equal(stock.status, 200);
  const input = { customerName: 'Test farm', phone: '', cropId: 1, plantsOrdered: 20, ratePerPlant: 15, requiredBy: addDays(today, 200) };
  const chk = await call('/orders/check', { token: mgr, body: input });
  assert.equal(chk.status, 200);
  assert.ok(['YES', 'PARTLY', 'NO'].includes(chk.body.decision));
  assert.equal((await call('/orders', { token: supB, body: input })).status, 403);
  assert.match((await call('/orders', { token: mgr, body: { ...input, requiredBy: today } })).body.error, /after today/);
  const o = await call('/orders', { token: mgr, body: input });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  made.orderIds.push(o.body.orderId);
  assert.equal(o.body.orderCode, `O-${100 + o.body.orderId}`);
  assert.equal((await call(`/orders/${o.body.orderId}/recheck`, { token: mgr, body: {} })).status, 200);

  const hardened = stock.body[0];
  if (hardened) {
    // Make the order deliverable whatever the forecast says, then send 5 plants.
    await prisma.salesOrder.update({ where: { orderId: o.body.orderId }, data: { decision: 'YES', plantsPromised: 20 } });
    const trays = await prisma.tray.findMany({ where: { batchId: hardened.batchId, status: 'ACTIVE', stage: { phase: 'HARDENING' } } });
    traysBefore.push(...trays.map((t) => ({ trayId: t.trayId, bottleCount: t.bottleCount, status: t.status, version: t.version })));
    const send = await call(`/orders/${o.body.orderId}/deliveries`, { token: mgr, body: { batchId: hardened.batchId, plants: 5, sentOn: today } });
    assert.equal(send.status, 201, JSON.stringify(send.body));
    const left = await prisma.tray.findMany({ where: { trayId: { in: trays.map((t) => t.trayId) } } });
    assert.equal(left.reduce((n, t) => n + t.bottleCount, 0), trays.reduce((n, t) => n + t.bottleCount, 0) - 5);
    assert.match((await call(`/orders/${o.body.orderId}/deliveries`, { token: mgr, body: { batchId: hardened.batchId, plants: 100, sentOn: today } })).body.error, /Only 15 plants are left/);
    const list = await call('/orders', { token: mgr });
    assert.equal(list.body.find((x: any) => x.orderId === o.body.orderId).plantsSent, 5);
  }
  assert.equal((await call(`/orders/${o.body.orderId}/cancel`, { token: mgr, body: {} })).status, 200);
  assert.match((await call(`/orders/${o.body.orderId}/cancel`, { token: mgr, body: {} })).body.error, /Only open orders/);
});

test('forecast and dashboard: manager only', async () => {
  const f = await call('/forecast', { token: mgr });
  assert.equal(f.status, 200);
  assert.ok(f.body.rows.length > 0);
  assert.ok(f.body.rows.every((r: any) => r.expectedPlants >= 0 && r.groups.length > 0));
  assert.equal((await call('/forecast', { token: supB })).status, 403);
  const d = await call('/dashboard', { token: mgr });
  assert.equal(d.status, 200);
  assert.ok(d.body.runningBatches > 0);
});

test('alerts: each person sees their own zones; supervisors acknowledge', async () => {
  const all = await call('/alerts', { token: mgr });
  assert.equal(all.status, 200);
  const mine = await call('/alerts', { token: supB });
  assert.ok(mine.body.every((a: any) => [3, 4, 6].includes(a.areaId)));
  const ops = await call('/alerts', { token: asha });
  assert.ok(ops.body.every((a: any) => a.areaId === 3 && (!a.userId || a.userId === 4)));
  const open = mine.body.find((a: any) => !a.ackAt);
  if (open) {
    assert.equal((await call('/alerts/acknowledge', { token: asha, body: { alertIds: [open.alertId] } })).status, 403);
    assert.equal((await call('/alerts/acknowledge', { token: supA, body: { alertIds: [open.alertId] } })).status, 404, 'not one of their zones');
    assert.equal((await call('/alerts/acknowledge', { token: supB, body: { alertIds: [open.alertId] } })).status, 200);
    ackedAlert = open.alertId;
    const after = await call('/alerts', { token: supB });
    assert.equal(after.body.find((a: any) => a.alertId === open.alertId).ackByName, 'Supervisor B');
  }
});

test('room, reports, audit and zones', async () => {
  const room = await call('/room?hours=24', { token: supB });
  assert.equal(room.status, 200);
  assert.ok(room.body.series.length > 200, 'a reading every 5 minutes');
  assert.equal((await call('/room', { token: asha })).status, 403);
  const month = await call(`/reports/month?month=${today.slice(0, 7)}`, { token: supB });
  assert.equal(month.status, 200);
  assert.equal(month.body.money, null, 'money figures are for the manager only');
  assert.ok((await call(`/reports/month?month=${today.slice(0, 7)}`, { token: mgr })).body.money);
  assert.equal((await call(`/reports/day?date=${today}`, { token: supB })).status, 200);
  assert.match((await call(`/reports/day?date=${addDays(today, 1)}`, { token: supB })).body.error, /today or an earlier day/);
  const audit = await call('/audit?days=1', { token: mgr });
  assert.ok(audit.body.some((a: any) => a.action === 'Saved stock item'));
  assert.equal((await call('/audit', { token: supB })).status, 403);
  const zones = await call('/zones', { token: supB });
  assert.deepEqual(zones.body.map((z: any) => z.areaId).sort(), [3, 4, 6]);
  assert.equal((await call('/zones/1', { token: supB })).status, 404);
  const z4 = await call('/zones/4', { token: supB });
  assert.equal(z4.status, 200);
  assert.ok(z4.body.benchLoad.length > 0);
  assert.equal((await call('/zones', { token: asha })).status, 403);
});

test('sensor node: posts readings with its key; the room page then shows real readings', async () => {
  const devs = await call('/iot/devices', { token: mgr });
  assert.equal(devs.status, 200);
  const dev = devs.body[0];
  if (!dev) return;
  if (dev.readings > 0) return; // a real node is already sending: leave its data alone
  assert.equal((await call(`/iot/devices/${dev.deviceId}/key`, { token: supB, body: {} })).status, 403);
  const k = await call(`/iot/devices/${dev.deviceId}/key`, { token: mgr, body: {} });
  assert.equal(k.status, 200);
  made.deviceKeys.push(dev.deviceId);
  const send = async (key: string, body: object) => {
    const res = await fetch(`${base()}/iot/readings`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': key }, body: JSON.stringify(body) });
    return res.status;
  };
  assert.equal(await send('wrong-key-wrong-key-wrong', { tempC: 25, humidityPct: 60 }), 401);
  assert.equal(await send(k.body.key, { tempC: 200, humidityPct: 60 }), 400);
  assert.equal(await send(k.body.key, { tempC: 25.4, humidityPct: 61, lightLux: 2400 }), 201);
  const room = await call('/room?hours=1', { token: mgr });
  assert.equal(room.body.simulated, false);
  assert.equal(room.body.latest.tempC, 25.4);
});
