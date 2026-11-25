// Batches, trays, sub-culture, moves and losses, with zone checks. Run: npm test
// Works on its own test batch, which is removed at the end; the sample batches are not touched.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '../src/db/prisma.js';
import { PHONES, call, start, stop, tokenFor } from './helpers.js';

const LAF1 = 5; // bench in Inoculation (zone 3)
const RACK1 = 11; // rack in the growth room (zone 4)
const RACK2 = 12;
const W1 = 1; // bench in Washing (zone 1)
const I1 = 1;
const I2 = 2;

const batchIds: number[] = [];
let mgr = '', asha = '', kiran = '', supA = '', supB = '';
let batchId = 0;
let trays: any[] = [];

before(async () => {
  await start();
  [mgr, asha, kiran, supA, supB] = await Promise.all(
    [PHONES.manager, PHONES.asha, PHONES.kiran, PHONES.supervisorA, PHONES.supervisorB].map((p) => tokenFor(p)),
  );
});
after(async () => {
  const where = { batchId: { in: batchIds } };
  await prisma.productionEntry.deleteMany({ where });
  await prisma.contamination.deleteMany({ where: { tray: where } });
  await prisma.trayMovement.deleteMany({ where });
  await prisma.tray.deleteMany({ where });
  await prisma.sample.deleteMany({ where });
  await prisma.batch.deleteMany({ where: { batchId: { in: batchIds }, parentBatchId: { not: null } } });
  await prisma.batch.deleteMany({ where });
  await stop();
});

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

test('only the manager starts a batch; its bottles go into trays of up to 30', async () => {
  const input = {
    cropId: 1, startDate: today(), bottles: 65, benchId: LAF1,
    samples: [{ sampleType: 'Sucker', noOfSamples: 2, sampleSize: 1, sourceFarm: 'Test farm', collectedAt: new Date().toISOString() }],
  };
  assert.equal((await call('/batches', { token: supB, body: input })).status, 403);
  assert.equal((await call('/batches', { token: mgr, body: { ...input, samples: [] } })).status, 400);
  const r = await call('/batches', { token: mgr, body: input });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  batchId = r.body.batchId;
  batchIds.push(batchId);
  assert.match(r.body.batchCode, /^B\d{1,2}-\d{2}[A-Z]?$/);

  const d = await call(`/batches/${batchId}`, { token: mgr });
  assert.equal(d.status, 200);
  trays = d.body.trays;
  assert.deepEqual(trays.map((t: any) => t.bottleCount).sort((a: number, b: number) => b - a), [30, 30, 5]);
  assert.ok(trays.every((t: any) => t.stageCode === 'I1' && t.areaId === 3 && t.qrCode.startsWith(r.body.batchCode + '-')));
  assert.equal(d.body.batch.liveBottles, 65);
  assert.equal(d.body.samples.length, 1);
});

test('people see trays only in their zones', async () => {
  const list = await call('/batches', { token: asha });
  assert.ok(list.body.some((b: any) => b.batchId === batchId), 'zone 3 operator sees the batch');
  const other = await call('/batches', { token: kiran });
  assert.ok(!other.body.some((b: any) => b.batchId === batchId), 'zone 1 operator does not');
  assert.equal((await call(`/batches/${batchId}`, { token: kiran })).status, 403);
  assert.equal((await call(`/trays/qr/${trays[0].qrCode}`, { token: kiran })).status, 403);
  const scan = await call(`/trays/qr/${trays[0].qrCode.toLowerCase()}`, { token: asha });
  assert.equal(scan.status, 200, 'QR code is found in any letter case');
  assert.equal(scan.body.trayId, trays[0].trayId);
  const mine = await call('/trays', { token: supA });
  assert.ok(mine.body.every((t: any) => [1, 2].includes(t.areaId)));
});

test('sub-culture: counts are checked', async () => {
  const t = trays.find((x: any) => x.bottleCount === 30);
  const go = (body: object) => call(`/trays/${t.trayId}/subculture`, { token: asha, body: { toStageId: I2, toBenchId: RACK1, bottlesOut: 50, bottlesLost: 0, ...body } });
  assert.match((await go({ bottlesOut: 200 })).body.error, /more than 6 times/);
  assert.match((await go({ bottlesLost: 2 })).body.error, /cause and type/);
  assert.equal((await go({ bottlesLost: 31 })).status, 400);
  assert.equal((await go({ bottlesOut: 0 })).status, 400);
  assert.equal((await go({ toStageId: 99 })).status, 400);
});

test('sub-culture makes new trays, records the loss and an entry for the supervisor', async () => {
  const t = trays.find((x: any) => x.bottleCount === 30);
  const r = await call(`/trays/${t.trayId}/subculture`, {
    token: asha,
    body: { toStageId: I2, toBenchId: RACK1, bottlesOut: 50, bottlesLost: 2, cause: 'LAB', contType: 'FUNGAL' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.map((x: any) => x.bottleCount), [30, 20]);
  assert.ok(r.body.every((x: any) => x.stageCode === 'I2' && x.benchId === RACK1));

  const old = await prisma.tray.findUniqueOrThrow({ where: { trayId: t.trayId } });
  assert.equal(old.status, 'MOVED');
  const entry = await prisma.productionEntry.findFirst({ where: { trayId: t.trayId } });
  assert.ok(entry, 'work entry made');
  assert.equal(entry!.status, 'PENDING');
  assert.equal(entry!.bottlesProduced, 50);
  assert.equal(await prisma.contamination.count({ where: { trayId: t.trayId } }), 1);

  const again = await call(`/trays/${t.trayId}/subculture`, { token: asha, body: { toStageId: I2, toBenchId: RACK1, bottlesOut: 10, bottlesLost: 0 } });
  assert.equal(again.status, 404, 'a tray already sub-cultured cannot be used again');
  assert.equal((await call(`/trays/qr/${t.qrCode}`, { token: asha })).status, 409);

  const d = await call(`/batches/${batchId}`, { token: mgr });
  assert.equal(d.body.batch.liveBottles, 30 + 5 + 50);
  assert.equal(d.body.batch.lostBottles, 2);
  assert.ok(d.body.history.some((h: any) => h.fromCode === 'I1' && h.toCode === 'I2' && h.bottlesOut === 50));
});

test('a loss lowers the tray count; the date cannot be in the future', async () => {
  const t = trays.find((x: any) => x.bottleCount === 5);
  const loss = { trayId: t.trayId, bottlesLost: 2, cause: 'OPERATOR', contType: 'BACTERIAL', foundOn: today(), note: 'test' };
  assert.equal((await call('/losses', { token: asha, body: { ...loss, foundOn: '2999-01-01' } })).status, 400);
  assert.equal((await call('/losses', { token: asha, body: { ...loss, bottlesLost: 6 } })).status, 400);
  assert.equal((await call('/losses', { token: kiran, body: loss })).status, 403);
  assert.equal((await call('/losses', { token: asha, body: loss })).status, 201);
  assert.equal((await prisma.tray.findUniqueOrThrow({ where: { trayId: t.trayId } })).bottleCount, 3);
  const list = await call('/losses', { token: supB });
  assert.ok(list.body.some((l: any) => l.trayId === t.trayId && l.reportedByName === 'Asha'));
  const notMine = await call('/losses', { token: supA });
  assert.ok(!notMine.body.some((l: any) => l.trayId === t.trayId));
});

test('moving trays: supervisor within own zones only, operators not at all', async () => {
  const t = trays.find((x: any) => x.bottleCount === 5);
  assert.equal((await call('/trays/move', { token: asha, body: { trayIds: [t.trayId], toBenchId: RACK2 } })).status, 403);
  assert.equal((await call('/trays/move', { token: supA, body: { trayIds: [t.trayId], toBenchId: W1 } })).status, 403, 'tray not in their zones');
  assert.equal((await call('/trays/move', { token: supB, body: { trayIds: [t.trayId], toBenchId: W1 } })).status, 403, 'bench not in their zones');
  const r = await call('/trays/move', { token: supB, body: { trayIds: [t.trayId], toBenchId: RACK2 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.moved, 1);
  const moved = await prisma.tray.findUniqueOrThrow({ where: { trayId: t.trayId } });
  assert.equal(moved.benchId, RACK2);
  assert.equal(moved.stageId, I1, 'stage does not change');
});

test('split and close a batch (manager only)', async () => {
  const d = await call(`/batches/${batchId}`, { token: mgr });
  const one = d.body.trays.find((x: any) => x.stageCode === 'I2');
  assert.equal((await call(`/batches/${batchId}/split`, { token: supB, body: { trayIds: [one.trayId] } })).status, 403);
  const all = d.body.trays.map((x: any) => x.trayId);
  assert.equal((await call(`/batches/${batchId}/split`, { token: mgr, body: { trayIds: all } })).status, 400, 'one tray must stay');
  const r = await call(`/batches/${batchId}/split`, { token: mgr, body: { trayIds: [one.trayId] } });
  assert.equal(r.status, 201);
  batchIds.push(r.body.batchId);
  assert.equal(r.body.batchCode, d.body.batch.batchCode + 'A');
  assert.equal(r.body.parentBatchId, batchId);
  assert.equal((await call(`/batches/${batchId}/close`, { token: mgr, body: {} })).status, 409, 'still has trays');
});

test('bench load and bottles handled per stage', async () => {
  const load = await call('/trays/bench-load', { token: supB });
  assert.equal(load.status, 200);
  assert.ok(load.body[RACK1] >= 1);
  const handled = await call('/trays/handled-by-stage', { token: mgr });
  assert.equal(handled.status, 200);
  assert.ok(handled.body.I1 > 0);
});
